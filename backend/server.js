// server.js - كود السيرفر الكامل مع لوحة التحكم المحدثة

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

// *** تعديل مهم: إضافة مفتاح الوصول الخاص بـ Mapbox هنا ***
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

// ====================================================================
// *** تعديل هام للأمان: قم بتغيير هذا الرمز السري إلى كلمة سر قوية! ***
 const ADMIN_SECRET = process.env.ADMIN_SECRET || "TareeqAdmin@2024";
// ====================================================================


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
            required: true
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
    }
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

const HolySiteSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    coords: { type: [Number], required: true },
    icon: { type: String },
    description: { type: String }
});
const HolySite = mongoose.model('HolySite', HolySiteSchema);

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
    likes: [{ type: String }],
    dislikes: [{ type: String }],
}, { timestamps: true });
CommunityPOISchema.index({ location: '2dsphere' });
const CommunityPOI = mongoose.model('CommunityPOI', CommunityPOISchema);

const GroupSchema = new mongoose.Schema({
    groupName: { type: String, required: true, unique: true },
    adminId: { type: String, required: true },
    members: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', GroupSchema);

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

// إعداد صفحة الأدمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../admin.html'));
});


const connectedUsers = {};

// وظيفة لحذف نقاط التجمع المنتهية
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

// تشغيل المهمة كل ساعة
setInterval(cleanupExpiredMeetingPoints, 3600000);

// منطق Socket.IO
io.on('connection', async (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    let user;
    let isAdmin = false; // Flag for admin connections

    // ===== قسم لوحة التحكم الجديد =====
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

    socket.on('admin_get_data', async (data) => {
        if (!isAdmin) return;

        try {
            let payload = {};
            const allUsers = await User.find({}, 'userId name').lean();
            const userMap = new Map(allUsers.map(u => [u.userId, u.name]));

            switch (data.type) {
                // ==========================================================
                // *** هنا تم تطبيق التعديل المطلوب ***
                // ==========================================================
                case 'stats':
                    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    
                    // 1. حسابات البطاقات
                    const [userCount, messageCount, poiCount, hostCount, activeUserCount] = await Promise.all([
                        User.countDocuments(),
                        Message.countDocuments(),
                        CommunityPOI.countDocuments(), // تصحيح الخطأ الإملائي هنا
                        Moazeb.countDocuments(),
                        User.countDocuments({ lastSeen: { $gte: sevenDaysAgo } })
                    ]);
                    const meetingCount = await User.countDocuments({ 'meetingPoint.name': { $exists: true } });

                    // 2. بيانات الرسوم البيانية
                    // تسجيل المستخدمين
                    const userRegData = await User.aggregate([
                        { $match: { createdAt: { $gte: sevenDaysAgo } } },
                        { $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Baghdad" } },
                            count: { $sum: 1 }
                        }},
                        { $sort: { _id: 1 } }
                    ]);

                    // توزيع أنواع المضايف
                    const hostTypesData = await Moazeb.aggregate([
                        { $group: { _id: "$type", count: { $sum: 1 } } }
                    ]);

                    payload = {
                        counts: { 
                            users: userCount, 
                            messages: messageCount, 
                            pois: poiCount, 
                            meetings: meetingCount, 
                            hosts: hostCount,
                            activeUsers: activeUserCount
                        },
                        charts: {
                            userRegistrations: {
                                labels: userRegData.map(d => d._id),
                                values: userRegData.map(d => d.count)
                            },
                            hostTypes: {
                                labels: hostTypesData.map(d => d._id),
                                values: hostTypesData.map(d => d.count)
                            }
                        }
                    };
                    break;
                    
                case 'users':
                    payload = await User.find({}, 'userId name photo linkCode phone email isBanned location').lean();
                    break;

                case 'active_users':
                    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    payload = await User.find(
                        { lastSeen: { $gte: oneWeekAgo }, isBanned: false },
                        'userId name photo lastSeen phone location'
                    ).sort({ lastSeen: -1 }).lean();
                    break;
                // ==========================================================
                // *** نهاية التعديل ***
                // ==========================================================

                case 'messages':
                    const messages = await Message.find().sort({ timestamp: -1 }).limit(200).lean();
                    payload = messages.map(msg => ({
                        ...msg,
                        senderName: userMap.get(msg.senderId) || 'مستخدم محذوف',
                        receiverName: userMap.get(msg.receiverId) || 'مستخدم محذوف'
                    }));
                    break;

                case 'pois':
                    const pois = await CommunityPOI.find().lean();
                    payload = pois.map(poi => ({
                        ...poi,
                        creatorName: userMap.get(poi.createdBy) || 'N/A'
                    }));
                    break;

                case 'meetings':
                    const usersWithMeetings = await User.find({ 'meetingPoint.name': { $exists: true } }, 'userId name meetingPoint').lean();
                    payload = usersWithMeetings.map(u => ({
                        _id: u._id, // an ID for deletion
                        name: u.meetingPoint.name,
                        location: u.meetingPoint.location,
                        expiresAt: u.meetingPoint.expiresAt,
                        creatorId: u.userId,
                        creatorName: u.name
                    }));
                    break;

                case 'hosts':
                    const hosts = await Moazeb.find().lean();
                    payload = hosts.map(host => ({
                        ...host,
                        creatorName: userMap.get(host.createdBy) || 'N/A'
                    }));
                    break;
            }
            socket.emit('admin_data_response', { type: data.type, payload });
        } catch (error) {
            console.error(`Error fetching admin data for type ${data.type}:`, error);
        }
    });
    
    socket.on('admin_ban_user', async (data) => {
        if (!isAdmin) return;
        try {
            const userToUpdate = await User.findOneAndUpdate({ userId: data.userId }, { $set: { isBanned: data.ban } });
            if(userToUpdate) {
                socket.emit('admin_operation_status', { success: true, message: `تم ${data.ban ? 'حظر' : 'فك حظر'} المستخدم بنجاح.` });
                if (data.ban && connectedUsers[data.userId]) {
                    io.to(connectedUsers[data.userId]).disconnect(true);
                }
            } else {
                 socket.emit('admin_operation_status', { success: false, message: 'لم يتم العثور على المستخدم.' });
            }
        } catch (error) {
            socket.emit('admin_operation_status', { success: false, message: 'حدث خطأ في الخادم.' });
        }
    });

    socket.on('admin_delete_item', async (data) => {
        if (!isAdmin) return;
        try {
            let result;
            switch(data.type) {
                case 'poi':
                    result = await CommunityPOI.deleteOne({ _id: data.id });
                    break;
                case 'meeting':
                    result = await User.updateOne({ _id: data.id }, { $unset: { meetingPoint: 1 } });
                    break;
                case 'host':
                    result = await Moazeb.deleteOne({ _id: data.id });
                    break;
                default:
                    socket.emit('admin_operation_status', { success: false, message: 'نوع غير صالح للحذف' });
                    return;
            }
            if(result.deletedCount > 0 || result.modifiedCount > 0) {
                socket.emit('admin_operation_status', { success: true, message: 'تم حذف العنصر بنجاح.' });
            } else {
                socket.emit('admin_operation_status', { success: false, message: 'لم يتم العثور على العنصر أو تم حذفه بالفعل.' });
            }
        } catch (error) {
             socket.emit('admin_operation_status', { success: false, message: 'حدث خطأ أثناء الحذف.' });
        }
    });

    socket.on('admin_update_item', async (data) => {
        if (!isAdmin) return;
        try {
            let result;
             switch(data.type) {
                case 'user':
                    result = await User.updateOne({ userId: data.id }, { $set: data.updates });
                    break;
                case 'poi':
                    result = await CommunityPOI.updateOne({ _id: data.id }, { $set: data.updates });
                    break;
                case 'host':
                    result = await Moazeb.updateOne({ _id: data.id }, { $set: data.updates });
                    break;
                default:
                    socket.emit('admin_operation_status', { success: false, message: 'نوع غير صالح للتحديث' });
                    return;
            }
            if(result.modifiedCount > 0) {
                socket.emit('admin_operation_status', { success: true, message: 'تم تحديث العنصر بنجاح.' });
            } else {
                socket.emit('admin_operation_status', { success: false, message: 'لم يتم العثور على العنصر أو لم يتم إجراء أي تغييرات.' });
            }
        } catch (error) {
            socket.emit('admin_operation_status', { success: false, message: 'حدث خطأ أثناء التحديث.' });
        }
    });
    // ===== نهاية قسم لوحة التحكم =====


    // منطق المستخدم العادي (يبقى كما هو)
    socket.on('registerUser', async (data) => {
        if (isAdmin) return; // Admins don't register as normal users
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
                    settings: {
                        emergencyWhatsapp: emergencyWhatsapp || '',
                        showPhone: true,
                        showEmail: true
                    },
                    gender: gender || 'other',
                    phone: phone || '',
                    email: email || ''
                });
                await user.save();
                console.log(`✨ تم إنشاء مستخدم جديد في DB: ${user.name} (${user.userId})`);
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
                console.log(`👤 مستخدم موجود في DB، تم تحديثه: ${user.name} (${user.userId})`);
            }

            connectedUsers[user.userId] = socket.id;
            socket.userId = user.userId;

            socket.emit('currentUserData', user);

            if (user.linkedFriends && user.linkedFriends.length > 0) {
                const friendsData = await User.find({ userId: { $in: user.linkedFriends } });
                socket.emit('updateFriendsList', friendsData);
            }

            if (user.settings.shareLocation && !user.settings.stealthMode && user.location && (user.location.coordinates[0] !== 0 || user.location.coordinates[1] !== 0)) {
                const locationData = {
                    userId: user.userId,
                    name: user.name,
                    photo: user.photo,
                    location: user.location.coordinates,
                    batteryStatus: user.batteryStatus,
                    settings: user.settings,
                    lastSeen: user.lastSeen,
                    gender: user.gender,
                    phone: user.phone,
                    email: user.email
                };

                user.linkedFriends.forEach(friendId => {
                    if (connectedUsers[friendId]) {
                        io.to(connectedUsers[friendId]).emit('locationUpdate', locationData);
                    }
                });
            }

            if (user.linkedMoazeb && user.linkedMoazeb.moazebId) {
                socket.emit('moazebConnectionData', { 
                    moazeb: user.linkedMoazeb.moazebId,
                    connectionLine: user.linkedMoazeb.connectionLine || []
                });
            }

        } catch (error) {
            console.error('❌ خطأ في معالجة تسجيل المستخدم:', error);
            socket.emit('registrationFailed', { message: 'فشل تسجيل المستخدم.' });
            socket.disconnect(true);
            return;
        }
    });

    socket.on('updateLocation', async (data) => {
        if (!socket.userId || !data.location || isAdmin) return;

        try {
            const updatedUser = await User.findOneAndUpdate(
                { userId: socket.userId },
                {
                    'location.coordinates': data.location,
                    batteryStatus: data.battery || 'N/A',
                    lastSeen: Date.now()
                },
                { new: true }
            );

            if (updatedUser) {
                if (updatedUser.isBanned) return;

                if (updatedUser.settings.shareLocation && !updatedUser.settings.stealthMode) {
                    if (updatedUser.location.coordinates[0] !== 0 || updatedUser.location.coordinates[1] !== 0) {
                        const newHistoricalLocation = new HistoricalLocation({
                            userId: updatedUser.userId,
                            location: {
                                type: 'Point',
                                coordinates: updatedUser.location.coordinates
                            },
                            timestamp: Date.now()
                        });
                        await newHistoricalLocation.save();
                    }

                    const locationData = {
                        userId: updatedUser.userId,
                        name: updatedUser.name,
                        photo: updatedUser.photo,
                        location: updatedUser.location.coordinates,
                        batteryStatus: updatedUser.batteryStatus,
                        settings: updatedUser.settings,
                        lastSeen: updatedUser.lastSeen,
                        gender: updatedUser.gender,
                        phone: updatedUser.phone,
                        email: updatedUser.email
                    };
                    
                    socket.emit('locationUpdate', locationData);
                    
                    updatedUser.linkedFriends.forEach(friendId => {
                         if (connectedUsers[friendId]) {
                            io.to(connectedUsers[friendId]).emit('locationUpdate', locationData);
                         }
                    });

                    if (updatedUser.linkedMoazeb && updatedUser.linkedMoazeb.moazebId) {
                        const moazeb = await Moazeb.findById(updatedUser.linkedMoazeb.moazebId);
                        if (moazeb) {
                            const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving/${updatedUser.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`);
                            const connectionLine = routeResponse.data.routes[0].geometry.coordinates;
                            
                            await User.updateOne(
                                { userId: updatedUser.userId },
                                { 'linkedMoazeb.connectionLine': connectionLine }
                            );
                            
                            socket.emit('moazebConnectionUpdate', {
                                moazebId: moazeb._id,
                                connectionLine: connectionLine
                            });
                        }
                    }
                } else {
                    io.emit('removeUserMarker', { userId: updatedUser.userId });
                }
            }
        } catch (error) {
            console.error('❌ خطأ في تحديث الموقع أو حفظ السجل التاريخي:', error);
        }
    });

    socket.on('requestLink', async (data) => {
        if (!user || !data.friendCode || isAdmin) {
            socket.emit('linkStatus', { success: false, message: 'بيانات الربط ناقصة.' });
            return;
        }

        try {
            const friendToLink = await User.findOne({ linkCode: data.friendCode });

            if (!friendToLink) {
                socket.emit('linkStatus', { success: false, message: 'رمز ربط غير صحيح أو المستخدم غير موجود.' });
                return;
            }

            if (friendToLink.isBanned) {
                socket.emit('linkStatus', { success: false, message: 'لا يمكن الربط مع هذا المستخدم.' });
                return;
            }

            if (user.userId === friendToLink.userId) {
                socket.emit('linkStatus', { success: false, message: 'لا يمكنك ربط نفسك!' });
                return;
            }

            if (!user.linkedFriends.includes(friendToLink.userId)) {
                user.linkedFriends.push(friendToLink.userId);
                await user.save();
            }

            if (!friendToLink.linkedFriends.includes(user.userId)) {
                friendToLink.linkedFriends.push(user.userId);
                await friendToLink.save();
            }

            socket.emit('linkStatus', { success: true, message: `✅ تم الربط بنجاح مع ${friendToLink.name}.` });
            console.log(`🔗 ${user.name} تم ربطه مع ${friendToLink.name}`);

            const updatedCurrentUserFriends = await User.find({ userId: { $in: user.linkedFriends } });
            socket.emit('updateFriendsList', updatedCurrentUserFriends);

            if (connectedUsers[friendToLink.userId]) {
                io.to(connectedUsers[friendToLink.userId]).emit('linkStatus', { success: true, message: `✅ تم الربط بك من قبل ${user.name}.` });
                const updatedFriendFriends = await User.find({ userId: { $in: friendToLink.linkedFriends } });
                io.to(connectedUsers[friendToLink.userId]).emit('updateFriendsList', updatedFriendFriends);
            }

        } catch (error) {
            console.error('❌ خطأ في معالجة طلب الربط:', error);
            socket.emit('linkStatus', { success: false, message: 'حدث خطأ أثناء الربط.' });
        }
    });
    
    socket.on('chatMessage', async (data) => {
        if (!socket.userId || !data.receiverId || !data.message || isAdmin) return;

        try {
            const newMessage = new Message({
                senderId: socket.userId,
                receiverId: data.receiverId,
                message: data.message,
            });
            await newMessage.save();

            if (connectedUsers[data.receiverId]) {
                const senderUser = await User.findOne({ userId: socket.userId });
                io.to(connectedUsers[data.receiverId]).emit('newChatMessage', {
                    senderId: socket.userId,
                    senderName: senderUser ? senderUser.name : 'مجهول',
                    message: data.message,
                    timestamp: newMessage.timestamp,
                    receiverId: data.receiverId
                });
            }
        } catch (error) {
            console.error('❌ خطأ في حفظ أو إرسال الرسالة:', error);
        }
    });

    socket.on('updateSettings', async (data) => {
        if (!user || isAdmin) return;
        try {
            user.settings = { ...user.settings, ...data };
            if (data.gender !== undefined) user.gender = data.gender;
            if (data.phone !== undefined) user.phone = data.phone;
            if (data.email !== undefined) user.email = data.email;

            await user.save();
            console.log(`⚙️ تم تحديث إعدادات ${user.name}:`, user.settings);

            if (!user.settings.shareLocation || user.settings.stealthMode) {
                io.emit('removeUserMarker', { userId: user.userId });
            } else {
                 if (user.location && user.location.coordinates) {
                    const locationData = {
                        userId: user.userId, name: user.name, photo: user.photo,
                        location: user.location.coordinates, batteryStatus: user.batteryStatus,
                        settings: user.settings, lastSeen: user.lastSeen, gender: user.gender,
                        phone: user.phone, email: user.email
                    };
                    user.linkedFriends.forEach(friendId => {
                        if (connectedUsers[friendId]) {
                           io.to(connectedUsers[friendId]).emit('locationUpdate', locationData);
                        }
                   });
                   socket.emit('locationUpdate', locationData);
                 }
            }
        } catch (error) {
            console.error('❌ خطأ في تحديث الإعدادات:', error);
        }
    });

    socket.on('requestFriendsData', async (data) => {
        if (!socket.userId || !data.friendIds || !Array.isArray(data.friendIds) || isAdmin) return;
        try {
            const friendsData = await User.find({ userId: { $in: data.friendIds } });
            socket.emit('updateFriendsList', friendsData);
        } catch (error) {
            console.error('❌ خطأ في جلب بيانات الأصدقاء:', error);
        }
    });

    socket.on('requestHistoricalPath', async (data) => {
        const { targetUserId, limit = 200 } = data;
        if (!user || !targetUserId || isAdmin) {
            socket.emit('historicalPathData', { success: false, message: 'بيانات الطلب ناقصة.' });
            return;
        }
        try {
            if (!user.linkedFriends.includes(targetUserId) && user.userId !== targetUserId) {
                socket.emit('historicalPathData', { success: false, message: 'غير مصرح لك برؤية هذا المسار.' });
                return;
            }
            const historicalLocations = await HistoricalLocation.find({ userId: targetUserId })
                .sort({ timestamp: 1 }).limit(limit);
            socket.emit('historicalPathData', { success: true, userId: targetUserId, path: historicalLocations });
        } catch (error) {
            console.error('❌ خطأ في جلب المسار التاريخي:', error);
            socket.emit('historicalPathData', { success: false, message: 'حدث خطأ أثناء جلب المسار.' });
        }
    });

    socket.on('unfriendUser', async (data) => {
        const { friendId } = data;
        if (!user || !friendId || isAdmin) return;

        try {
            const friendToUnlink = await User.findOne({ userId: friendId });
            if (!friendToUnlink) return;

            user.linkedFriends = user.linkedFriends.filter(id => id !== friendId);
            await user.save();
            friendToUnlink.linkedFriends = friendToUnlink.linkedFriends.filter(id => id !== user.userId);
            await friendToUnlink.save();

            socket.emit('unfriendStatus', { success: true, message: `🗑️ تم إلغاء الارتباط بنجاح.` });
            const updatedCurrentUserFriends = await User.find({ userId: { $in: user.linkedFriends } });
            socket.emit('updateFriendsList', updatedCurrentUserFriends);

            if (connectedUsers[friendToUnlink.userId]) {
                io.to(connectedUsers[friendToUnlink.userId]).emit('unfriendStatus', { success: true, message: `💔 قام ${user.name} بإلغاء الربط معك.` });
                const updatedFriendFriends = await User.find({ userId: { $in: friendToUnlink.linkedFriends } });
                io.to(connectedUsers[friendToUnlink.userId]).emit('updateFriendsList', updatedFriendFriends);
                io.to(connectedUsers[friendToUnlink.userId]).emit('removeUserMarker', { userId: user.userId });
            }
            socket.emit('removeUserMarker', { userId: friendId });

        } catch (error) {
            console.error('❌ خطأ في إلغاء الارتباط:', error);
            socket.emit('unfriendStatus', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('addCommunityPOI', async (data) => {
        const { name, description, category, location, icon } = data;
        if (!user || !name || !location || isAdmin) return;

        try {
            const newPOI = new CommunityPOI({
                name, description, category,
                location: { type: 'Point', coordinates: location },
                createdBy: user.userId, isApproved: true, icon
            });
            await newPOI.save();
            
            await User.findByIdAndUpdate(
                user._id,
                { $push: { createdPOIs: newPOI._id } },
                { new: true }
            );

            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name} بنجاح.` });
            
            io.emit('newPOIAdded', newPOI);

        } catch (error) {
            console.error('❌ خطأ في إضافة POI:', error);
            socket.emit('poiStatus', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('deletePOI', async (data) => {
        const { poiId } = data;
        if (!user || !poiId || isAdmin) return;

        try {
            const poi = await CommunityPOI.findById(poiId);
            if (!poi) {
                socket.emit('poiDeleted', { success: false, message: 'نقطة الاهتمام غير موجودة.' });
                return;
            }

            if (poi.createdBy !== user.userId) {
                socket.emit('poiDeleted', { success: false, message: 'غير مسموح لك بحذف هذه النقطة.' });
                return;
            }

            await CommunityPOI.findByIdAndDelete(poiId);
            await User.findByIdAndUpdate(
                user._id,
                { $pull: { createdPOIs: poiId } },
                { new: true }
            );

            socket.emit('poiDeleted', { success: true, message: 'تم الحذف بنجاح.', poiId });
            
            io.emit('poiDeletedBroadcast', { poiId: poiId });

        } catch (error) {
            console.error('❌ خطأ في حذف POI:', error);
            socket.emit('poiDeleted', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('requestPOIs', async () => {
        if (isAdmin) return;
        try {
            const pois = await CommunityPOI.find({ isApproved: true });
            socket.emit('updatePOIsList', pois);
        } catch (error) {
            console.error('❌ خطأ في جلب POIs:', error);
        }
    });

    socket.on('requestChatHistory', async (data) => {
        const { friendId } = data;
        if (!socket.userId || !friendId || isAdmin) return;
        try {
            const chatHistory = await Message.find({
                $or: [
                    { senderId: socket.userId, receiverId: friendId },
                    { senderId: friendId, receiverId: socket.userId }
                ]
            }).sort({ timestamp: 1 });
            socket.emit('chatHistoryData', { success: true, friendId: friendId, history: chatHistory });
        } catch (error) {
            console.error('❌ خطأ في جلب سجل الدردشة:', error);
        }
    });

    socket.on('setMeetingPoint', async (data) => {
        if (!user || !data.name || !data.location || isAdmin) return;
        try {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            
            user.meetingPoint = {
                name: data.name,
                location: { type: 'Point', coordinates: data.location },
                expiresAt: expiresAt
            };
            await user.save();
            
            const meetingData = {
                creatorId: user.userId,
                creatorName: user.name,
                point: user.meetingPoint
            };
            
            io.to(socket.id).emit('newMeetingPoint', meetingData);
            user.linkedFriends.forEach(friendId => {
                if (connectedUsers[friendId]) {
                    io.to(connectedUsers[friendId]).emit('newMeetingPoint', meetingData);
                }
            });

        } catch (error) {
            console.error('❌ خطأ في تحديد نقطة التجمع:', error);
        }
    });

    socket.on('clearMeetingPoint', async () => {
        if (!user || isAdmin) return;
        try {
            const creatorId = user.userId;
            user.meetingPoint = undefined;
            await user.save();
    
            io.to(socket.id).emit('meetingPointCleared', { creatorId });
            user.linkedFriends.forEach(friendId => {
                if (connectedUsers[friendId]) {
                    io.to(connectedUsers[friendId]).emit('meetingPointCleared', { creatorId });
                }
            });
    
        } catch (error) {
            console.error('❌ خطأ في إنهاء نقطة التجمع:', error);
        }
    });

    socket.on('addMoazeb', async (data) => {
        if (!user || !data.name || !data.address || !data.phone || !data.governorate || !data.district || !data.location || isAdmin) {
            socket.emit('moazebStatus', { success: false, message: 'البيانات ناقصة.' });
            return;
        }
        try {
            const newMoazeb = new Moazeb({
                ...data,
                location: { type: 'Point', coordinates: data.location },
                createdBy: user.userId
            });
            await newMoazeb.save();
            socket.emit('moazebStatus', { success: true, message: '✅ تم إضافة المضيف بنجاح!' });
        } catch (error) {
            console.error('❌ خطأ في إضافة مضيف:', error);
            socket.emit('moazebStatus', { success: false, message: 'حدث خطأ في الخادم.' });
        }
    });

    socket.on('searchMoazeb', async (query) => {
        if (isAdmin) return;
        try {
            const searchCriteria = {};
            if (query.phone) searchCriteria.phone = { $regex: query.phone, $options: 'i' };
            if (query.governorate) searchCriteria.governorate = { $regex: query.governorate, $options: 'i' };
            if (query.district) searchCriteria.district = { $regex: query.district, $options: 'i' };

            const results = await Moazeb.find(searchCriteria).limit(20);
            socket.emit('moazebSearchResults', { success: true, results });

        } catch (error) {
            console.error('❌ خطأ في البحث عن مضيف:', error);
        }
    });

    socket.on('getAllMoazeb', async () => {
        if (isAdmin) return;
        try {
            const moazebs = await Moazeb.find().limit(100);
            socket.emit('allMoazebData', { success: true, moazebs });
        } catch (error) {
            console.error('❌ خطأ في جلب جميع المضيفين:', error);
            socket.emit('allMoazebData', { success: false, message: 'خطأ في الخادم' });
        }
    });

    socket.on('linkToMoazeb', async (data) => {
        const { moazebId } = data;
        if (!user || !moazebId || isAdmin) {
            socket.emit('linkToMoazebStatus', { success: false, message: 'بيانات ناقصة.' });
            return;
        }

        try {
            const moazeb = await Moazeb.findById(moazebId);
            if (!moazeb) {
                socket.emit('linkToMoazebStatus', { success: false, message: 'المضيف غير موجود.' });
                return;
            }

            if (!moazeb.linkedUsers.includes(user.userId)) {
                moazeb.linkedUsers.push(user.userId);
                await moazeb.save();
            }

            let connectionLine = [];
            if (user.location && user.location.coordinates && user.location.coordinates[0] !== 0) {
                const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving/${user.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`);
                connectionLine = routeResponse.data.routes[0].geometry.coordinates;
            }

            user.linkedMoazeb = {
                moazebId: moazeb._id,
                linkedAt: new Date(),
                connectionLine: connectionLine
            };
            await user.save();

            socket.emit('linkToMoazebStatus', { 
                success: true, 
                message: `تم الربط مع المضيف ${moazeb.name} بنجاح. رقم الهاتف: ${moazeb.phone}`,
                moazeb: moazeb,
                connectionLine: connectionLine
            });

            socket.emit('moazebConnectionData', { 
                moazeb: moazeb,
                connectionLine: connectionLine
            });

        } catch (error) {
            console.error('❌ خطأ في الربط مع المضيف:', error);
            socket.emit('linkToMoazebStatus', { success: false, message: 'حدث خطأ في الخادم.' });
        }
    });

    socket.on('unlinkFromMoazeb', async () => {
        if (!user || !user.linkedMoazeb || isAdmin) return;

        try {
            const moazebId = user.linkedMoazeb.moazebId;
            user.linkedMoazeb = undefined;
            await user.save();

            await Moazeb.findByIdAndUpdate(moazebId, {
                $pull: { linkedUsers: user.userId }
            });

            socket.emit('unlinkFromMoazebStatus', { 
                success: true, 
                message: 'تم إلغاء الربط مع المضيف بنجاح.'
            });

            socket.emit('moazebConnectionRemoved');

        } catch (error) {
            console.error('❌ خطأ في إلغاء الربط مع المضيف:', error);
            socket.emit('unlinkFromMoazebStatus', { 
                success: false, 
                message: 'حدث خطأ أثناء إلغاء الربط.'
            });
        }
    });

    socket.on('requestPrayerTimes', async () => {
        if (isAdmin) return;
        try {
            const latitude = 32.6163;
            const longitude = 44.0249;
            const method = 2;
            const date = new Date();
            const dateString = `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
            
            const response = await axios.get(`http://api.aladhan.com/v1/timings/${dateString}`, {
                params: { latitude, longitude, method }
            });

            if (response.data && response.data.code === 200) {
                socket.emit('prayerTimesData', { success: true, timings: response.data.data.timings });
            } else {
                throw new Error('Failed to fetch prayer times from API.');
            }
        } catch (error) {
            console.error("❌ خطأ في جلب أوقات الصلاة:", error.message);
            socket.emit('prayerTimesData', { success: false, message: 'فشل جلب أوقات الصلاة.' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`👋 مستخدم قطع الاتصال: ${socket.id}`);
        if (socket.userId && connectedUsers[socket.userId]) {
            delete connectedUsers[socket.userId];
        }
    });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🔗 افتح متصفحك على: http://localhost:${PORT}`);
    console.log(`🔑 لوحة التحكم على: http://localhost:${PORT}/admin`);
});
