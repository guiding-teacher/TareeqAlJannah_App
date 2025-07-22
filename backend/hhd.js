// server.js

// تحميل متغيرات البيئة من ملف .env
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose'); // استيراد Mongoose

const app = express();
const server = http.createServer(app);

const io = new socketIo.Server(server, {
    cors: {
        origin: "*", // السماح بالاتصال من أي نطاق (ضروري للتطوير)
        methods: ["GET", "POST"]
    }
});

// ====== الاتصال بقاعدة بيانات MongoDB ======
// استخدام متغير البيئة لعنوان قاعدة البيانات
const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/tareeq_aljannah';
mongoose.connect(DB_URI) // إزالة الخيارات المهملة
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
        stealthMode: { type: Boolean, default: false }
    },
    batteryStatus: { type: String, default: 'N/A' },
    lastSeen: { type: Date, default: Date.now }
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

const Message = mongoose.model('Message', MessageSchema);


// 3. نموذج المواقع المقدسة (Holy Site Model - ثابتة من الصورة)
const HolySiteSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    coords: {
        type: [Number],
        required: true
    },
    icon: { type: String },
    description: { type: String }
});

const HolySite = mongoose.model('HolySite', HolySiteSchema);


// 4. نموذج سجل المواقع التاريخية (HistoricalLocation Model)
const HistoricalLocationSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
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
    timestamp: { type: Date, default: Date.now }
});

HistoricalLocationSchema.index({ userId: 1, timestamp: -1 });
HistoricalLocationSchema.index({ location: '2dsphere' });

const HistoricalLocation = mongoose.model('HistoricalLocation', HistoricalLocationSchema);


// 5. نموذج نقاط الاهتمام المجتمعية (CommunityPOI Model)
const CommunityPOISchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    category: { type: String, enum: ['Rest Area', 'Medical Post', 'Food Station', 'Other'], default: 'Rest Area' },
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
    createdBy: { type: String, required: true },
    isApproved: { type: Boolean, default: true }, // تغيير مؤقت: اجعلها true لكي تظهر مباشرة
    likes: [{ type: String }],
    dislikes: [{ type: String }],
}, { timestamps: true });

CommunityPOISchema.index({ location: '2dsphere' });

const CommunityPOI = mongoose.model('CommunityPOI', CommunityPOISchema);


// ====== إعدادات Express ======
app.use(express.static(path.join(__dirname, '../'))); // لخدمة ملفات الواجهة الأمامية من المجلد الأب
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// قائمة لمتابعة المستخدمين المتصلين حالياً ومعرفات Socket الخاصة بهم
const connectedUsers = {}; // { userId: socket.id }

// ====== منطق Socket.IO (التعامل مع اتصالات في الوقت الفعلي) ======
io.on('connection', async (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    let user; // تعريف متغير user هنا ليكون متاحاً في نطاق socket

    socket.on('registerUser', async (data) => {
        const { userId, name, photo } = data;

        try {
            user = await User.findOne({ userId: userId });

            if (!user) {
                user = new User({
                    userId: userId,
                    name: name || `مستخدم_${Math.random().toString(36).substring(2, 7)}`,
                    photo: photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER',
                    location: { type: 'Point', coordinates: [0, 0] },
                    linkCode: Math.random().toString(36).substring(2, 9).toUpperCase()
                });
                await user.save();
                console.log(`✨ تم إنشاء مستخدم جديد في DB: ${user.name} (${user.userId})`);
            } else {
                if (name && user.name !== name) user.name = name;
                if (photo && user.photo !== photo) user.photo = photo;
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
                    const newHistoricalLocation = new HistoricalLocation({
                        userId: updatedUser.userId,
                        location: {
                            type: 'Point',
                            coordinates: updatedUser.location.coordinates
                        },
                        timestamp: Date.now()
                    });
                    await newHistoricalLocation.save();
                    // console.log(`💾 تم حفظ موقع تاريخي لـ ${updatedUser.name}`);

                    console.log(`📍 تم تحديث موقع ${updatedUser.name}: ${updatedUser.location.coordinates}`);

                    const friendsOfCurrentUser = await User.find({
                        userId: { $in: updatedUser.linkedFriends }
                    });

                    friendsOfCurrentUser.forEach(friend => {
                        if (connectedUsers[friend.userId]) {
                            io.to(connectedUsers[friend.userId]).emit('locationUpdate', {
                                userId: updatedUser.userId,
                                name: updatedUser.name,
                                photo: updatedUser.photo,
                                location: updatedUser.location.coordinates,
                                battery: updatedUser.batteryStatus,
                                settings: updatedUser.settings,
                                lastSeen: updatedUser.lastSeen
                            });
                        }
                    });
                    socket.emit('locationUpdate', {
                        userId: updatedUser.userId,
                        name: updatedUser.name,
                        photo: updatedUser.photo,
                        location: updatedUser.location.coordinates,
                        battery: updatedUser.batteryStatus,
                        settings: updatedUser.settings,
                        lastSeen: updatedUser.lastSeen
                    });
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
            console.log(`💬 رسالة جديدة من ${socket.userId} إلى ${receiverId}: ${message}`);

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
            await user.save();
            console.log(`⚙️ تم تحديث إعدادات ${user.name}:`, user.settings);

            if (!user.settings.shareLocation || user.settings.stealthMode) {
                io.emit('removeUserMarker', { userId: user.userId });
            } else {
                if (user.location && user.location.coordinates) {
                    const friendsOfUser = await User.find({ userId: { $in: user.linkedFriends } });
                    friendsOfUser.forEach(friend => {
                        if (connectedUsers[friend.userId]) {
                            io.to(connectedUsers[friend.userId]).emit('locationUpdate', {
                                userId: user.userId,
                                name: user.name,
                                photo: user.photo,
                                location: user.location.coordinates,
                                battery: user.batteryStatus,
                                settings: user.settings,
                                lastSeen: user.lastSeen
                            });
                        }
                    });
                    socket.emit('locationUpdate', {
                        userId: user.userId,
                        name: user.name,
                        photo: user.photo,
                        location: user.location.coordinates,
                        battery: user.batteryStatus,
                        settings: user.settings,
                        lastSeen: user.lastSeen
                    });
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
        if (!user || !targetUserId) {
            socket.emit('historicalPathData', { success: false, message: 'بيانات الطلب ناقصة.' });
            return;
        }

        try {
            if (!user.linkedFriends.includes(targetUserId) && user.userId !== targetUserId) {
                socket.emit('historicalPathData', { success: false, message: 'غير مصرح لك برؤية هذا المسار.' });
                return;
            }

            const historicalLocations = await HistoricalLocation.find({ userId: targetUserId })
                .sort({ timestamp: 1 })
                .limit(limit);

            socket.emit('historicalPathData', { success: true, userId: targetUserId, path: historicalLocations });
            console.log(`📈 تم جلب ${historicalLocations.length} نقطة مسار تاريخي لـ ${targetUserId}`);
        } catch (error) {
            console.error('❌ خطأ في جلب المسار التاريخي:', error);
            socket.emit('historicalPathData', { success: false, message: 'حدث خطأ أثناء جلب المسار.' });
        }
    });

    socket.on('unfriendUser', async (data) => {
        const { friendId } = data;
        if (!user || !friendId) {
            socket.emit('unfriendStatus', { success: false, message: 'بيانات إلغاء الارتباط ناقصة.' });
            return;
        }

        try {
            const friendToUnlink = await User.findOne({ userId: friendId });

            if (!friendToUnlink) {
                socket.emit('unfriendStatus', { success: false, message: 'المستخدم أو الصديق غير موجود.' });
                return;
            }

            user.linkedFriends = user.linkedFriends.filter(id => id !== friendId);
            await user.save();

            friendToUnlink.linkedFriends = friendToUnlink.linkedFriends.filter(id => id !== user.userId);
            await friendToUnlink.save();

            socket.emit('unfriendStatus', { success: true, message: `🗑️ تم إلغاء الارتباط بنجاح مع ${friendToUnlink.name}.` });
            console.log(`💔 ${user.name} تم إلغاء ربطه من ${friendToUnlink.name}`);

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
            console.error('❌ خطأ في معالجة طلب إلغاء الارتباط:', error);
            socket.emit('unfriendStatus', { success: false, message: 'حدث خطأ أثناء إلغاء الارتباط.' });
        }
    });

    socket.on('addCommunityPOI', async (data) => {
        const { name, description, category, location } = data;
        if (!user || !name || !location || !Array.isArray(location) || location.length !== 2) {
            socket.emit('poiStatus', { success: false, message: 'بيانات نقطة الاهتمام ناقصة أو غير صحيحة.' });
            return;
        }

        try {
            const newPOI = new CommunityPOI({
                name,
                description,
                category,
                location: {
                    type: 'Point',
                    coordinates: location
                },
                createdBy: user.userId,
                isApproved: true // تم تعيينها لـ true لتظهر مباشرة
            });
            await newPOI.save();
            console.log(`➕ تم إضافة نقطة اهتمام جديدة بواسطة ${user.userId}: ${newPOI.name}`);
            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name} بنجاح.` });

            // إرسال تحديث لجميع العملاء لتحميل نقاط الاهتمام الجديدة
            io.emit('updatePOIs'); // طلب تحديث POIs من كل العملاء

        } catch (error)
        {
            console.error('❌ خطأ في إضافة نقطة اهتمام:', error);
            socket.emit('poiStatus', { success: false, message: 'حدث خطأ أثناء إضافة نقطة الاهتمام.' });
        }
    });

    socket.on('requestPOIs', async () => {
        try {
            const pois = await CommunityPOI.find({ isApproved: true }); // الآن جلب فقط المعتمدة
            socket.emit('updatePOIsList', pois);
            console.log(`🗺️ تم جلب ${pois.length} نقطة اهتمام.`);
        } catch (error) {
            console.error('❌ خطأ في جلب نقاط الاهتمام:', error);
            socket.emit('updatePOIsList', []);
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