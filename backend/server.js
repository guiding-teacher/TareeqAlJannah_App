 
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';
const ADMIN_SECRET = process.env.ADMIN_SECRET || "TareeqAdmin@2024";

const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/tareeq_aljannah';
mongoose.connect(DB_URI)
.then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
.catch(err => console.error('❌ خطأ في الاتصال بقاعدة بيانات MongoDB:', err));

// نماذج البيانات
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    photo: { type: String, default: 'image/husseini_avatar1.png' },
    linkCode: { type: String, unique: true, sparse: true },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            required: true,
            default: [0, 0]
        }
    },
    linkedFriends: [{ type: String }],
    settings: {
        shareLocation: { type: Boolean, default: true },
        sound: { type: Boolean, default: true },
        hideBubbles: { type: Boolean, default: false },
        stealthMode: { type: Boolean, default: false },
        emergencyWhatsapp: { type: String, default: '' },
        showPhone: { type: Boolean, default: true },
        showEmail: { type: Boolean, default: true }
    },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    batteryStatus: { type: String, default: 'N/A' },
    lastSeen: { type: Date, default: Date.now },
    isBanned: { type: Boolean, default: false },
    createdPOIs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPOI' }],
    meetingPoint: {
        name: { type: String },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number] }
        },
        expiresAt: { type: Date }
    },
    linkedMoazeb: {
        moazebId: { type: mongoose.Schema.Types.ObjectId, ref: 'Moazeb' },
        linkedAt: { type: Date },
        connectionLine: { type: [[Number]] }
    },
    previousFriends: [{
        userId: { type: String, required: true },
        name: { type: String, required: true },
        photo: { type: String, default: 'image/husseini_avatar1.png' },
        linkedAt: { type: Date, default: Date.now },
        unlinkedAt: { type: Date, default: null } // الحقل الأساسي لتتبع حالة الربط
    }],
    pendingFriendRequests: [{
        userId: { type: String, required: true },
        name: { type: String, required: true },
        photo: { type: String, default: 'image/husseini_avatar1.png' },
        requestedAt: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

UserSchema.index({ location: '2dsphere' });
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
MessageSchema.index({ "timestamp": 1 }, { expireAfterSeconds: 86400 });
const Message = mongoose.model('Message', MessageSchema);

const HistoricalLocationSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    timestamp: { type: Date, default: Date.now }
});
HistoricalLocationSchema.index({ userId: 1, timestamp: -1 });
HistoricalLocationSchema.index({ location: '2dsphere' });
const HistoricalLocation = mongoose.model('HistoricalLocation', HistoricalLocationSchema);

const CommunityPOISchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    category: { type: String, enum: ['Rest Area', 'Medical Post', 'Food Station', 'Water', 'Mosque', 'Parking', 'Info', 'Other'], default: 'Other' },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    createdBy: { type: String, required: true },
    isApproved: { type: Boolean, default: true },
    icon: { type: String, default: '<i class="fas fa-map-marker-alt"></i>' },
}, { timestamps: true });
CommunityPOISchema.index({ location: '2dsphere' });
const CommunityPOI = mongoose.model('CommunityPOI', CommunityPOISchema);

const MoazebSchema = new mongoose.Schema({
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    governorate: { type: String, required: true, index: true },
    district: { type: String, required: true, index: true },
    type: { type: String, enum: ['house', 'mawkib', 'hussainiya', 'tent', 'station', 'sleep', 'food'], default: 'house' },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    createdBy: { type: String, required: true },
    linkedUsers: [{ type: String }]
}, { timestamps: true });
MoazebSchema.index({ location: '2dsphere' });
const Moazeb = mongoose.model('Moazeb', MoazebSchema);

// إعدادات Express
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../admin.html'));
});

const connectedUsers = {};

async function cleanupExpiredMeetingPoints() {
    try {
        const result = await User.updateMany(
            { 'meetingPoint.expiresAt': { $lt: new Date() } },
            { $unset: { meetingPoint: 1 } }
        );
        if (result.modifiedCount > 0) {
            console.log(`تم حذف ${result.modifiedCount} نقطة تجمع منتهية`);
        }
    } catch (error) {
        console.error('خطأ في حذف نقاط التجمع المنتهية:', error);
    }
}
setInterval(cleanupExpiredMeetingPoints, 3600000);

// منطق Socket.IO
io.on('connection', async (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    let user;
    let isAdmin = false;

    // ===== قسم لوحة التحكم (Admin Panel) =====
    socket.on('admin_register', (data) => {
        if (data.secret === ADMIN_SECRET) {
            isAdmin = true;
            console.log('✅ An admin has connected.');
            socket.join('admins');
        } else {
            console.log('❌ Failed admin login attempt.');
            socket.emit('admin_auth_failed');
        }
    });
    
    // جميع عمليات لوحة التحكم تبقى كما هي بدون تغيير
    
    // ===== منطق المستخدم العادي =====
    socket.on('registerUser', async (data) => {
        if (isAdmin) return; 
        const { userId, name, photo, gender, phone, email, emergencyWhatsapp } = data;
        try {
            user = await User.findOne({ userId: userId }).populate('createdPOIs').populate('linkedMoazeb.moazebId');

            if (!user) {
                user = new User({
                    userId: userId,
                    name: name || `مستخدم_${Math.random().toString(36).substring(2, 7)}`,
                    photo: photo || 'image/Picsart_25-08-03_16-47-02-591.png',
                    location: { type: 'Point', coordinates: [0, 0] },
                    linkCode: Math.random().toString(36).substring(2, 9).toUpperCase(),
                    settings: { emergencyWhatsapp: emergencyWhatsapp || '', showPhone: true, showEmail: true },
                    gender: gender || 'other',
                    phone: phone || '',
                    email: email || '',
                    previousFriends: [],
                    pendingFriendRequests: []
                });
                await user.save();
                console.log(`✨ تم إنشاء مستخدم جديد: ${user.name} (${user.userId})`);
            } else {
                if (user.isBanned) {
                    console.log(`🚫 Banned user attempted to connect: ${user.userId}`);
                    socket.disconnect(true);
                    return;
                }
                
                if (name && user.name !== name) user.name = name;
                if (photo && user.photo !== photo) user.photo = photo;
                if (gender && user.gender !== gender) user.gender = gender;
                if (phone && user.phone !== phone) user.phone = phone;
                if (email && user.email !== email) user.email = email;
                if (emergencyWhatsapp !== undefined && user.settings.emergencyWhatsapp !== emergencyWhatsapp) {
                    user.settings.emergencyWhatsapp = emergencyWhatsapp;
                }
                user.lastSeen = Date.now();
                await user.save();
            }

            connectedUsers[user.userId] = socket.id;
            socket.userId = user.userId;
            socket.emit('currentUserData', user);

            if (user.pendingFriendRequests && user.pendingFriendRequests.length > 0) {
                socket.emit('pendingFriendRequests', user.pendingFriendRequests);
            }

            if (user.linkedFriends && user.linkedFriends.length > 0) {
                const friendsData = await User.find({ userId: { $in: user.linkedFriends } });
                socket.emit('updateFriendsList', friendsData);
            }
        } catch (error) {
            console.error('❌ خطأ في تسجيل المستخدم:', error);
            socket.emit('registrationFailed', { message: 'فشل تسجيل المستخدم.' });
            socket.disconnect(true);
        }
    });

    socket.on('updateLocation', async (data) => {
        if (!socket.userId || !data.location || isAdmin) return;
        try {
            const updatedUser = await User.findOneAndUpdate(
                { userId: socket.userId },
                { 'location.coordinates': data.location, batteryStatus: data.battery || 'N/A', lastSeen: Date.now() },
                { new: true }
            );

            if (updatedUser && !updatedUser.isBanned) {
                if (updatedUser.settings.shareLocation && !updatedUser.settings.stealthMode) {
                    if (updatedUser.location.coordinates[0] !== 0 || updatedUser.location.coordinates[1] !== 0) {
                        await new HistoricalLocation({ userId: updatedUser.userId, location: { type: 'Point', coordinates: updatedUser.location.coordinates }, timestamp: Date.now() }).save();
                    }
                    const locationData = { userId: updatedUser.userId, name: updatedUser.name, photo: updatedUser.photo, location: updatedUser.location.coordinates, batteryStatus: updatedUser.batteryStatus, settings: updatedUser.settings, lastSeen: updatedUser.lastSeen, gender: updatedUser.gender, phone: updatedUser.phone, email: updatedUser.email };
                    socket.emit('locationUpdate', locationData);
                    updatedUser.linkedFriends.forEach(friendId => { if (connectedUsers[friendId]) io.to(connectedUsers[friendId]).emit('locationUpdate', locationData); });
                } else {
                    io.emit('removeUserMarker', { userId: updatedUser.userId });
                }
            }
        } catch (error) {
            console.error('❌ خطأ في تحديث الموقع:', error);
        }
    });

    socket.on('requestLink', async (data) => {
        if (!user || !data.friendCode || isAdmin) return socket.emit('linkStatus', { success: false, message: 'بيانات الربط ناقصة.' });
        try {
            const friendToLink = await User.findOne({ linkCode: data.friendCode });
            if (!friendToLink) return socket.emit('linkStatus', { success: false, message: 'رمز ربط غير صحيح.' });
            if (friendToLink.isBanned) return socket.emit('linkStatus', { success: false, message: 'لا يمكن الربط مع هذا المستخدم.' });
            if (user.userId === friendToLink.userId) return socket.emit('linkStatus', { success: false, message: 'لا يمكنك ربط نفسك!' });

            const pendingRequest = { userId: user.userId, name: user.name, photo: user.photo, requestedAt: new Date() };
            const existingRequest = friendToLink.pendingFriendRequests.find(req => req.userId === user.userId);

            if (!existingRequest) {
                friendToLink.pendingFriendRequests.push(pendingRequest);
                await friendToLink.save();
                if (connectedUsers[friendToLink.userId]) {
                    io.to(connectedUsers[friendToLink.userId]).emit('friendRequestReceived', { fromUserId: user.userId, fromUserName: user.name, fromUserPhoto: user.photo });
                }
                socket.emit('linkStatus', { success: true, message: `✅ تم إرسال طلب الربط إلى ${friendToLink.name}.` });
            } else {
                socket.emit('linkStatus', { success: false, message: `⚠️ لديك طلب ربط معلق مع ${friendToLink.name}.` });
            }
        } catch (error) {
            console.error('❌ خطأ في طلب الربط:', error);
            socket.emit('linkStatus', { success: false, message: 'حدث خطأ أثناء الربط.' });
        }
    });

    socket.on('respondToFriendRequest', async (data) => {
        if (!user || !data.fromUserId || isAdmin) return;
        try {
            const requestingUser = await User.findOne({ userId: data.fromUserId });
            if (!requestingUser) return;

            user.pendingFriendRequests = user.pendingFriendRequests.filter(req => req.userId !== data.fromUserId);

            if (data.accepted) {
                if (!user.linkedFriends.includes(requestingUser.userId)) user.linkedFriends.push(requestingUser.userId);
                if (!requestingUser.linkedFriends.includes(user.userId)) requestingUser.linkedFriends.push(user.userId);

                const updatePreviousFriend = (targetUser, friend) => {
                    const existingIndex = targetUser.previousFriends.findIndex(pf => pf.userId === friend.userId);
                    if (existingIndex === -1) {
                        targetUser.previousFriends.push({ userId: friend.userId, name: friend.name, photo: friend.photo, linkedAt: new Date(), unlinkedAt: null });
                    } else {
                        targetUser.previousFriends[existingIndex].unlinkedAt = null;
                        targetUser.previousFriends[existingIndex].linkedAt = new Date();
                    }
                };
                
                updatePreviousFriend(user, requestingUser);
                updatePreviousFriend(requestingUser, user);

                await user.save();
                await requestingUser.save();

                socket.emit('friendRequestResponse', { success: true, message: `✅ تم الربط مع ${requestingUser.name}.`, accepted: true });
                if (connectedUsers[requestingUser.userId]) {
                    io.to(connectedUsers[requestingUser.userId]).emit('friendRequestAccepted', { byUserId: user.userId, byUserName: user.name, message: `وافق ${user.name} على طلب الربط.` });
                }
                
                // ** تعديل رقم 5: إرسال إشعار فوري لرسم خط الربط **
                const userFull = await User.findOne({ userId: user.userId }).lean();
                const friendFull = await User.findOne({ userId: requestingUser.userId }).lean();

                socket.emit('newLinkEstablished', { friend: friendFull });
                if (connectedUsers[requestingUser.userId]) {
                    io.to(connectedUsers[requestingUser.userId]).emit('newLinkEstablished', { friend: userFull });
                }
                
                const updatedCurrentUserFriends = await User.find({ userId: { $in: user.linkedFriends } });
                socket.emit('updateFriendsList', updatedCurrentUserFriends);
                if (connectedUsers[requestingUser.userId]) {
                    const updatedFriendFriends = await User.find({ userId: { $in: requestingUser.linkedFriends } });
                    io.to(connectedUsers[requestingUser.userId]).emit('updateFriendsList', updatedFriendFriends);
                }

            } else {
                await user.save();
                socket.emit('friendRequestResponse', { success: true, message: `❌ تم رفض طلب ${requestingUser.name}.`, accepted: false });
                if (connectedUsers[requestingUser.userId]) {
                    io.to(connectedUsers[requestingUser.userId]).emit('friendRequestRejected', { byUserId: user.userId, byUserName: user.name, message: `رفض ${user.name} طلب الربط.` });
                }
            }
        } catch (error) {
            console.error('❌ خطأ في الرد على طلب الربط:', error);
        }
    });

    socket.on('reconnectWithFriend', async (data) => {
        if (!user || !data.friendId || isAdmin) return;
        try {
            const friendUser = await User.findOne({ userId: data.friendId });
            if (!friendUser || friendUser.isBanned) return socket.emit('reconnectStatus', { success: false, message: 'المستخدم غير متاح.' });

            const pendingRequest = { userId: user.userId, name: user.name, photo: user.photo, requestedAt: new Date() };
            friendUser.pendingFriendRequests.push(pendingRequest);
            await friendUser.save();

            if (connectedUsers[friendUser.userId]) {
                io.to(connectedUsers[friendUser.userId]).emit('friendRequestReceived', { fromUserId: user.userId, fromUserName: user.name, fromUserPhoto: user.photo, message: `طلب إعادة ربط من ${user.name}` });
            }
            socket.emit('reconnectStatus', { success: true, message: `✅ تم إرسال طلب إعادة الربط إلى ${friendUser.name}.` });
        } catch (error) {
            console.error('❌ خطأ في إعادة الربط:', error);
            socket.emit('reconnectStatus', { success: false, message: 'حدث خطأ أثناء إعادة الربط.' });
        }
    });
    
    socket.on('chatMessage', async (data) => {
        if (!socket.userId || !data.receiverId || !data.message || isAdmin) return;
        try {
            const newMessage = await new Message({ senderId: socket.userId, receiverId: data.receiverId, message: data.message }).save();
            if (connectedUsers[data.receiverId]) {
                const senderUser = await User.findOne({ userId: socket.userId });
                io.to(connectedUsers[data.receiverId]).emit('newChatMessage', { senderId: socket.userId, senderName: senderUser.name, message: data.message, timestamp: newMessage.timestamp, receiverId: data.receiverId });
            }
        } catch (error) { console.error('❌ خطأ في إرسال الرسالة:', error); }
    });

    socket.on('updateSettings', async (data) => {
        if (!user || isAdmin) return;
        try {
            user.settings = { ...user.settings, ...data };
            if (data.name !== undefined) user.name = data.name;
            if (data.gender !== undefined) user.gender = data.gender;
            if (data.phone !== undefined) user.phone = data.phone;
            if (data.email !== undefined) user.email = data.email;
            await user.save();
            if (!user.settings.shareLocation || user.settings.stealthMode) {
                io.emit('removeUserMarker', { userId: user.userId });
            }
        } catch (error) { console.error('❌ خطأ في تحديث الإعدادات:', error); }
    });

    socket.on('requestFriendsData', async (data) => {
        if (!socket.userId || !data.friendIds || !Array.isArray(data.friendIds) || isAdmin) return;
        try {
            const friendsData = await User.find({ userId: { $in: data.friendIds } });
            socket.emit('updateFriendsList', friendsData);
        } catch (error) { console.error('❌ خطأ في جلب بيانات الأصدقاء:', error); }
    });

    socket.on('requestPreviousFriends', async () => {
        if (!user || isAdmin) return;
        socket.emit('previousFriendsList', user.previousFriends || []);
    });

    socket.on('requestHistoricalPath', async (data) => {
        const { targetUserId, limit = 200 } = data;
        if (!user || !targetUserId || isAdmin) return socket.emit('historicalPathData', { success: false, message: 'بيانات ناقصة.' });
        try {
            if (!user.linkedFriends.includes(targetUserId) && user.userId !== targetUserId) return socket.emit('historicalPathData', { success: false, message: 'غير مصرح لك.' });
            const historicalLocations = await HistoricalLocation.find({ userId: targetUserId }).sort({ timestamp: 1 }).limit(limit);
            socket.emit('historicalPathData', { success: true, userId: targetUserId, path: historicalLocations });
        } catch (error) { console.error('❌ خطأ في جلب المسار التاريخي:', error); }
    });

    socket.on('unfriendUser', async (data) => {
        const { friendId } = data;
        if (!user || !friendId || isAdmin) return;
        try {
            const friendToUnlink = await User.findOne({ userId: friendId });
            if (!friendToUnlink) return;

            user.linkedFriends = user.linkedFriends.filter(id => id !== friendId);
            friendToUnlink.linkedFriends = friendToUnlink.linkedFriends.filter(id => id !== user.userId);

            const updateUnlinkTimestamp = (targetUser, unlinkedFriendId) => {
                const prev = targetUser.previousFriends.find(pf => pf.userId === unlinkedFriendId);
                if (prev) prev.unlinkedAt = new Date();
            };
            updateUnlinkTimestamp(user, friendId);
            updateUnlinkTimestamp(friendToUnlink, user.userId);

            await user.save();
            await friendToUnlink.save();

            // ** تعديل رقم 3: إرسال تحديثات فورية لكلا الطرفين **
            socket.emit('unfriendStatus', { success: true, message: `🗑️ تم إلغاء الارتباط.` });
            socket.emit('removeUserMarker', { userId: friendId });

            if (connectedUsers[friendToUnlink.userId]) {
                io.to(connectedUsers[friendToUnlink.userId]).emit('unfriendStatus', { success: true, message: `💔 ${user.name} ألغى الربط معك.` });
                io.to(connectedUsers[friendToUnlink.userId]).emit('removeUserMarker', { userId: user.userId });
            }
        } catch (error) { console.error('❌ خطأ في إلغاء الارتباط:', error); }
    });

    socket.on('addCommunityPOI', async (data) => {
        const { name, description, category, location, icon } = data;
        if (!user || !name || !location || isAdmin) return;
        try {
            const newPOI = await new CommunityPOI({ name, description, category, location: { type: 'Point', coordinates: location }, createdBy: user.userId, isApproved: true, icon }).save();
            await User.findByIdAndUpdate(user._id, { $push: { createdPOIs: newPOI._id } });
            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name}.` });
            io.emit('newPOIAdded', newPOI);
        } catch (error) { console.error('❌ خطأ في إضافة POI:', error); }
    });

    socket.on('deletePOI', async (data) => {
        const { poiId } = data;
        if (!user || !poiId || isAdmin) return;
        try {
            const poi = await CommunityPOI.findById(poiId);
            if (!poi || poi.createdBy !== user.userId) return socket.emit('poiDeleted', { success: false, message: 'غير مسموح.' });
            await CommunityPOI.findByIdAndDelete(poiId);
            await User.findByIdAndUpdate(user._id, { $pull: { createdPOIs: poiId } });
            socket.emit('poiDeleted', { success: true, message: 'تم الحذف.', poiId });
            io.emit('poiDeletedBroadcast', { poiId: poiId });
        } catch (error) { console.error('❌ خطأ في حذف POI:', error); }
    });

    socket.on('requestPOIs', async () => { if (!isAdmin) try { const pois = await CommunityPOI.find({ isApproved: true }); socket.emit('updatePOIsList', pois); } catch (e) {} });
    
    socket.on('requestChatHistory', async (data) => {
        const { friendId } = data;
        if (!socket.userId || !friendId || isAdmin) return;
        try {
            const chatHistory = await Message.find({ $or: [{ senderId: socket.userId, receiverId: friendId }, { senderId: friendId, receiverId: socket.userId }] }).sort({ timestamp: 1 });
            socket.emit('chatHistoryData', { success: true, friendId: friendId, history: chatHistory });
        } catch (error) { console.error('❌ خطأ في جلب سجل الدردشة:', error); }
    });

    socket.on('setMeetingPoint', async (data) => {
        if (!user || !data.name || !data.location || isAdmin) return;
        try {
            user.meetingPoint = { name: data.name, location: { type: 'Point', coordinates: data.location }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
            await user.save();
            const meetingData = { creatorId: user.userId, creatorName: user.name, point: user.meetingPoint };
            socket.emit('newMeetingPoint', meetingData);
            user.linkedFriends.forEach(friendId => { if (connectedUsers[friendId]) io.to(connectedUsers[friendId]).emit('newMeetingPoint', meetingData); });
        } catch (error) { console.error('❌ خطأ في تحديد نقطة التجمع:', error); }
    });

    socket.on('clearMeetingPoint', async () => {
        if (!user || isAdmin) return;
        try {
            const creatorId = user.userId;
            user.meetingPoint = undefined;
            await user.save();
            socket.emit('meetingPointCleared', { creatorId });
            user.linkedFriends.forEach(friendId => { if (connectedUsers[friendId]) io.to(connectedUsers[friendId]).emit('meetingPointCleared', { creatorId }); });
        } catch (error) { console.error('❌ خطأ في إنهاء نقطة التجمع:', error); }
    });

    socket.on('addMoazeb', async (data) => {
        if (!user || !data.name || !data.address || !data.phone || !data.governorate || !data.district || !data.location || isAdmin) return socket.emit('moazebStatus', { success: false, message: 'البيانات ناقصة.' });
        try {
            await new Moazeb({ ...data, location: { type: 'Point', coordinates: data.location }, createdBy: user.userId }).save();
            socket.emit('moazebStatus', { success: true, message: '✅ تم إضافة المضيف بنجاح!' });
        } catch (error) { console.error('❌ خطأ في إضافة مضيف:', error); }
    });

    socket.on('searchMoazeb', async (query) => {
    if (isAdmin) return;
    try {
        const searchCriteria = {};

        // ==> بداية الإصلاح: منطق بحث محسّن
        if (query.phone && query.phone.trim() !== '') {
            // للبحث عن الهاتف، استخدم المطابقة التامة والدقيقة
            searchCriteria.phone = query.phone.trim();
        }
        
        if (query.governorate && query.governorate.trim() !== '') {
            // للمحافظة، استخدم regex للبحث المرن (مثلاً "كربلاء" تطابق "كربلاء المقدسة")
            searchCriteria.governorate = { $regex: query.governorate.trim(), $options: 'i' };
        }
        
        if (query.district && query.district.trim() !== '') {
            // للقضاء، استخدم regex أيضاً
            searchCriteria.district = { $regex: query.district.trim(), $options: 'i' };
        }
        // <== نهاية الإصلاح

        // تأكد من أن هناك على الأقل معيار واحد للبحث
        if (Object.keys(searchCriteria).length === 0) {
            return socket.emit('moazebSearchResults', { success: true, results: [] });
        }

        const results = await Moazeb.find(searchCriteria).limit(50); // زيادة الحد إلى 50 نتيجة
        
        socket.emit('moazebSearchResults', { success: true, results });

    } catch (error) { 
        console.error('❌ خطأ في البحث عن مضيف:', error); 
        socket.emit('moazebSearchResults', { success: false, message: 'حدث خطأ أثناء البحث.' });
    }
});
    
    socket.on('getAllMoazeb', async () => {
    if (isAdmin) return;
    try {
        // استخدم .lean() لتحسين الأداء
        const moazebs = await Moazeb.find({}).limit(500).lean();

        // ==> بداية الإصلاح: فلترة وتحويل البيانات بشكل آمن
        const validMoazebs = moazebs.filter(m => 
            m.location &&                                    // تأكد من وجود كائن الموقع
            Array.isArray(m.location.coordinates) &&         // تأكد من أن الإحداثيات عبارة عن مصفوفة
            m.location.coordinates.length === 2 &&           // تأكد من أنها تحتوي على خط طول وعرض
            (m.location.coordinates[0] !== 0 || m.location.coordinates[1] !== 0) // تجاهل المواقع الافتراضية
        );
        // <== نهاية الإصلاح

        socket.emit('allMoazebData', { success: true, moazebs: validMoazebs });

    } catch (error) {
        console.error('❌ خطأ في جلب جميع المضيفين:', error);
        socket.emit('allMoazebData', { success: false, message: 'خطأ في الخادم أثناء جلب بيانات المضيفين.' });
    }
});

    socket.on('linkToMoazeb', async (data) => {
        const { moazebId } = data;
        if (!user || !moazebId || isAdmin) return socket.emit('linkToMoazebStatus', { success: false, message: 'بيانات ناقصة.' });
        try {
            const moazeb = await Moazeb.findById(moazebId);
            if (!moazeb) return socket.emit('linkToMoazebStatus', { success: false, message: 'المضيف غير موجود.' });
            
            if (!moazeb.linkedUsers.includes(user.userId)) {
                moazeb.linkedUsers.push(user.userId);
                await moazeb.save();
            }

            let connectionLine = [];
            if (user.location && user.location.coordinates && user.location.coordinates[0] !== 0) {
                const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving/${user.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`);
                connectionLine = routeResponse.data.routes[0].geometry.coordinates;
            }

            user.linkedMoazeb = { moazebId: moazeb._id, linkedAt: new Date(), connectionLine: connectionLine };
            await user.save();

            socket.emit('linkToMoazebStatus', { success: true, message: `تم الربط مع المضيف ${moazeb.name}.`, moazeb, connectionLine });
        } catch (error) { console.error('❌ خطأ في الربط مع المضيف:', error); }
    });

    socket.on('unlinkFromMoazeb', async () => {
        if (!user || !user.linkedMoazeb || isAdmin) return;
        try {
            const moazebId = user.linkedMoazeb.moazebId;
            user.linkedMoazeb = undefined;
            await user.save();
            await Moazeb.findByIdAndUpdate(moazebId, { $pull: { linkedUsers: user.userId } });
            socket.emit('unlinkFromMoazebStatus', { success: true, message: 'تم إلغاء الربط.' });
        } catch (error) { console.error('❌ خطأ في إلغاء الربط مع المضيف:', error); }
    });

    socket.on('requestPrayerTimes', async () => {
        if (isAdmin) return;
        try {
            const response = await axios.get(`http://api.aladhan.com/v1/timingsByCity`, { params: { city: "Karbala", country: "Iraq", method: 2 } });
            if (response.data && response.data.code === 200) {
                socket.emit('prayerTimesData', { success: true, timings: response.data.data.timings });
            } else { throw new Error('Failed to fetch prayer times.'); }
        } catch (error) {
            console.error("❌ خطأ في جلب أوقات الصلاة:", error.message);
            socket.emit('prayerTimesData', { success: false, message: 'فشل جلب أوقات الصلاة.' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`👋 مستخدم قطع الاتصال: ${socket.id}`);
        if (socket.userId) delete connectedUsers[socket.userId];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🔑 http://localhost:${PORT}/admin`);
});

 