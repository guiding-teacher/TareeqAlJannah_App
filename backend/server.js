// server.js

// تحميل متغيرات البيئة من ملف .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios'); // لجلب أوقات الصلاة

const app = express();
const server = http.createServer(app);

const io = new socketIo.Server(server, {
    cors: {
        origin: "*", // السماح بالاتصال من أي نطاق (ضروري للتطوير)
        methods: ["GET", "POST"]
    }
});

// ====== الاتصال بقاعدة بيانات MongoDB ======
const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/tareeq_aljannah';
mongoose.connect(DB_URI)
.then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
.catch(err => console.error('❌ خطأ في الاتصال بقاعدة بيانات MongoDB:', err));


// ====== تعريف نماذج البيانات (Mongoose Schemas) ======

// 1. نموذج المستخدم (User Model)
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    photo: { type: String, default: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER' },
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
        emergencyWhatsapp: { type: String, default: '' }
    },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    batteryStatus: { type: String, default: 'N/A' },
    lastSeen: { type: Date, default: Date.now },
    // حفظ نقاط الاهتمام التي أنشأها المستخدم
    createdPOIs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPOI' }],
    // حفظ نقطة التجمع الخاصة بالمستخدم
    meetingPoint: {
        name: { type: String },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number] }
        }
    }
}, { timestamps: true });

UserSchema.index({ location: '2dsphere' });
const User = mongoose.model('User', UserSchema);


// 2. نموذج الرسائل (Message Model)
const MessageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    receiverId: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
MessageSchema.index({ "timestamp": 1 }, { expireAfterSeconds: 86400 });
const Message = mongoose.model('Message', MessageSchema);


// 3. نموذج المواقع المقدسة (Holy Site Model)
const HolySiteSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    coords: { type: [Number], required: true },
    icon: { type: String },
    description: { type: String }
});
const HolySite = mongoose.model('HolySite', HolySiteSchema);


// 4. نموذج سجل المواقع التاريخية (HistoricalLocation Model)
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


// 5. نموذج نقاط الاهتمام المجتمعية (CommunityPOI Model)
const CommunityPOISchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    // إضافة فئات جديدة
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


// 6. نموذج المجموعة (Group Model)
const GroupSchema = new mongoose.Schema({
    groupName: { type: String, required: true, unique: true },
    adminId: { type: String, required: true },
    members: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', GroupSchema);

// 7. نموذج المعزب (Moazeb Model)
const MoazebSchema = new mongoose.Schema({
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    governorate: { type: String, required: true, index: true },
    district: { type: String, required: true, index: true },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], required: true }
    },
    createdBy: { type: String, required: true },
}, { timestamps: true });
MoazebSchema.index({ location: '2dsphere' });
const Moazeb = mongoose.model('Moazeb', MoazebSchema);


// ====== إعدادات Express ======
app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

const connectedUsers = {};

// ====== منطق Socket.IO (التعامل مع اتصالات في الوقت الفعلي) ======
io.on('connection', async (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    let user;

    socket.on('registerUser', async (data) => {
        const { userId, name, photo, gender, phone, email, emergencyWhatsapp } = data;

        try {
            user = await User.findOne({ userId: userId });

            if (!user) {
                user = new User({
                    userId: userId,
                    name: name || `مستخدم_${Math.random().toString(36).substring(2, 7)}`,
                    photo: photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER',
                    location: { type: 'Point', coordinates: [0, 0] },
                    linkCode: Math.random().toString(36).substring(2, 9).toUpperCase(),
                    settings: {
                        emergencyWhatsapp: emergencyWhatsapp || ''
                    },
                    gender: gender || 'other',
                    phone: phone || '',
                    email: email || ''
                });
                await user.save();
                console.log(`✨ تم إنشاء مستخدم جديد في DB: ${user.name} (${user.userId})`);
            } else {
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

        } catch (error) {
            console.error('❌ خطأ في معالجة تسجيل المستخدم:', error);
            socket.emit('registrationFailed', { message: 'فشل تسجيل المستخدم.' });
            socket.disconnect(true);
            return;
        }
    });

    socket.on('updateLocation', async (data) => {
        if (!socket.userId || !data.location) return;

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
                        battery: updatedUser.batteryStatus,
                        settings: updatedUser.settings,
                        lastSeen: updatedUser.lastSeen,
                        gender: updatedUser.gender,
                        phone: updatedUser.phone,
                        email: updatedUser.email
                    };

                    // إرسال التحديث للأصدقاء المرتبطين
                    updatedUser.linkedFriends.forEach(friendId => {
                         if (connectedUsers[friendId]) {
                            io.to(connectedUsers[friendId]).emit('locationUpdate', locationData);
                         }
                    });

                    // إرسال التحديث للمستخدم نفسه
                    socket.emit('locationUpdate', locationData);

                } else {
                    io.emit('removeUserMarker', { userId: updatedUser.userId });
                }
            }
        } catch (error) {
            console.error('❌ خطأ في تحديث الموقع أو حفظ السجل التاريخي:', error);
        }
    });

    socket.on('requestLink', async (data) => {
        const { friendCode } = data;
        if (!user || !friendCode) {
            socket.emit('linkStatus', { success: false, message: 'بيانات الربط ناقصة.' });
            return;
        }

        try {
            const friendToLink = await User.findOne({ linkCode: friendCode });

            if (!friendToLink) {
                socket.emit('linkStatus', { success: false, message: 'رمز ربط غير صحيح أو المستخدم غير موجود.' });
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
        const { receiverId, message } = data;
        if (!socket.userId || !receiverId || !message) return;

        try {
            const newMessage = new Message({
                senderId: socket.userId,
                receiverId: receiverId,
                message: message,
            });
            await newMessage.save();

            if (connectedUsers[receiverId]) {
                const senderUser = await User.findOne({ userId: socket.userId });
                io.to(connectedUsers[receiverId]).emit('newChatMessage', {
                    senderId: socket.userId,
                    senderName: senderUser ? senderUser.name : 'مجهول',
                    message: message,
                    timestamp: newMessage.timestamp,
                    receiverId: receiverId
                });
            }
        } catch (error) {
            console.error('❌ خطأ في حفظ أو إرسال الرسالة:', error);
        }
    });

    socket.on('updateSettings', async (data) => {
        if (!user) return;
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
                 // إرسال تحديث الموقع مجدداً بعد تغيير الإعدادات لضمان ظهور المركر
                 if (user.location && user.location.coordinates) {
                    const locationData = {
                        userId: user.userId, name: user.name, photo: user.photo,
                        location: user.location.coordinates, battery: user.batteryStatus,
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
        if (!socket.userId || !data.friendIds || !Array.isArray(data.friendIds)) return;
        try {
            const friendsData = await User.find({ userId: { $in: data.friendIds } });
            socket.emit('updateFriendsList', friendsData);
        } catch (error) {
            console.error('❌ خطأ في جلب بيانات الأصدقاء:', error);
        }
    });

    socket.on('requestHistoricalPath', async (data) => {
        const { targetUserId, limit = 100 } = data;
        if (!user || !targetUserId) return;
        try {
            if (!user.linkedFriends.includes(targetUserId) && user.userId !== targetUserId) {
                socket.emit('historicalPathData', { success: false, message: 'غير مصرح لك.' });
                return;
            }
            const historicalLocations = await HistoricalLocation.find({ userId: targetUserId })
                .sort({ timestamp: -1 }).limit(limit);
            socket.emit('historicalPathData', { success: true, userId: targetUserId, path: historicalLocations.reverse() });
        } catch (error) {
            console.error('❌ خطأ في جلب المسار التاريخي:', error);
            socket.emit('historicalPathData', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('unfriendUser', async (data) => {
        const { friendId } = data;
        if (!user || !friendId) return;

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
        if (!user || !name || !location) return;

        try {
            const newPOI = new CommunityPOI({
                name, description, category,
                location: { type: 'Point', coordinates: location },
                createdBy: user.userId, isApproved: true, icon
            });
            await newPOI.save();
            
            user.createdPOIs.push(newPOI._id);
            await user.save();

            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name} بنجاح.` });
            io.emit('updatePOIs');

        } catch (error) {
            console.error('❌ خطأ في إضافة POI:', error);
            socket.emit('poiStatus', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('requestPOIs', async () => {
        try {
            const pois = await CommunityPOI.find({ isApproved: true });
            socket.emit('updatePOIsList', pois);
        } catch (error) {
            console.error('❌ خطأ في جلب POIs:', error);
        }
    });

    socket.on('requestChatHistory', async (data) => {
        const { friendId } = data;
        if (!socket.userId || !friendId) return;
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
        if (!user || !data.name || !data.location) return;
        try {
            user.meetingPoint = {
                name: data.name,
                location: { type: 'Point', coordinates: data.location }
            };
            await user.save();
            const meetingData = {
                creatorId: user.userId,
                creatorName: user.name,
                point: user.meetingPoint
            };
            socket.emit('newMeetingPoint', meetingData);
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
        if (!user) return;
        try {
            const creatorId = user.userId;
            user.meetingPoint = undefined;
            await user.save();
            socket.emit('meetingPointCleared', { creatorId });
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
        if (!user || !data.name || !data.address || !data.phone || !data.governorate || !data.district || !data.location) {
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

    socket.on('requestPrayerTimes', async () => {
        try {
            const latitude = 32.6163; // كربلاء
            const longitude = 44.0249; // كربلاء
            const method = 2; // Jafari (Ithna Ashari)
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

// ====== تشغيل الخادم ======
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🔗 افتح متصفحك على: http://localhost:${PORT}`);
});
