// server.js

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = path.join(__dirname, '../');
const mongoose = require('mongoose');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);

const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/tareeq_aljannah';
mongoose.connect(DB_URI)
.then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
.catch(err => console.error('❌ خطأ في الاتصال بقاعدة بيانات MongoDB:', err));

// نماذج البيانات
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true, sparse: true },
    password: { type: String, required: true },
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
    email: { type: String, default: '' },
    batteryStatus: { type: String, default: 'N/A' },
    lastSeen: { type: Date, default: Date.now },
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
        linkedAt: { type: Date }
    },
    verificationCode: String,
    verificationCodeExpires: Date,
    isVerified: { type: Boolean, default: false }
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

app.use(express.static(path.join(__dirname, '../')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

const connectedUsers = {};
let user; // To hold the authenticated user object for the socket session

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
setInterval(cleanupExpiredMeetingPoints, 3600000);

// منطق Socket.IO
io.on('connection', (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    // --- New Authentication Flow ---

    socket.on('auth:register', async ({ phone, password }) => {
        try {
            const existingUser = await User.findOne({ phone });
            if (existingUser) {
                return socket.emit('auth:error', 'رقم الهاتف هذا مسجل بالفعل.');
            }

            const hashedPassword = await bcrypt.hash(password, 12);
            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            const newUser = new User({
                phone,
                password: hashedPassword,
                name: `زائر_${phone.slice(-4)}`,
                userId: `user_${Math.random().toString(36).substring(2, 15)}`,
                linkCode: Math.random().toString(36).substring(2, 9).toUpperCase(),
                verificationCode,
                verificationCodeExpires: Date.now() + 3600000, // 1 hour
                isVerified: false,
            });

            await newUser.save();

            // *** SIMULATE SENDING SMS ***
            // In a real application, you would use an SMS gateway like Twilio here.
            console.log(`====== [SMS SIMULATION] ======`);
            console.log(`رمز التحقق للمستخدم ${phone} هو: ${verificationCode}`);
            console.log(`==============================`);
            // ****************************

            socket.emit('auth:show_verify', { phone });

        } catch (error) {
            console.error('Registration error:', error);
            socket.emit('auth:error', 'حدث خطأ أثناء التسجيل.');
        }
    });

    socket.on('auth:verify', async ({ phone, code }) => {
        try {
            const userToVerify = await User.findOne({
                phone,
                verificationCode: code,
                verificationCodeExpires: { $gt: Date.now() }
            });

            if (!userToVerify) {
                return socket.emit('auth:error', 'رمز التحقق غير صحيح أو منتهي الصلاحية.');
            }

            userToVerify.isVerified = true;
            userToVerify.verificationCode = undefined;
            userToVerify.verificationCodeExpires = undefined;
            await userToVerify.save();

            socket.emit('auth:login_success', userToVerify);

        } catch (error) {
            console.error('Verification error:', error);
            socket.emit('auth:error', 'حدث خطأ أثناء التحقق.');
        }
    });

    socket.on('auth:login', async ({ phone, password }) => {
        try {
            const userToLogin = await User.findOne({ phone }).populate('createdPOIs').populate({ path: 'linkedMoazeb.moazebId' });
            if (!userToLogin) {
                return socket.emit('auth:error', 'رقم الهاتف أو كلمة المرور غير صحيحة.');
            }

            const isMatch = await bcrypt.compare(password, userToLogin.password);
            if (!isMatch) {
                return socket.emit('auth:error', 'رقم الهاتف أو كلمة المرور غير صحيحة.');
            }
            
            if (!userToLogin.isVerified) {
                 // Resend verification for unverified accounts
                const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
                userToLogin.verificationCode = verificationCode;
                userToLogin.verificationCodeExpires = Date.now() + 3600000;
                await userToLogin.save();
                console.log(`====== [SMS SIMULATION] ======`);
                console.log(`إعادة إرسال رمز التحقق للمستخدم ${phone} هو: ${verificationCode}`);
                console.log(`==============================`);
                socket.emit('auth:show_verify', { phone });
                return socket.emit('auth:error', 'حسابك غير مفعل. تم إرسال رمز تحقق جديد.');
            }


            socket.emit('auth:login_success', userToLogin);

        } catch (error) {
            console.error('Login error:', error);
            socket.emit('auth:error', 'حدث خطأ أثناء تسجيل الدخول.');
        }
    });

    socket.on('user:initialize_session', async (data) => {
        const { userId } = data;
        try {
            user = await User.findOne({ userId }).populate('createdPOIs').populate({ path: 'linkedMoazeb.moazebId' });
            if (!user) {
                socket.emit('error', 'User not found for session initialization.');
                return socket.disconnect(true);
            }

            connectedUsers[user.userId] = socket.id;
            socket.userId = user.userId;
            console.log(`✅ تم ربط الجلسة للمستخدم: ${user.name} (${user.userId})`);

            // Send initial data to the newly connected user
            socket.emit('user:session_initialized', user);

            if (user.linkedFriends && user.linkedFriends.length > 0) {
                const friendsData = await User.find({ userId: { $in: user.linkedFriends } });
                socket.emit('updateFriendsList', friendsData);
            }

            if (user.linkedMoazeb && user.linkedMoazeb.moazebId) {
                socket.emit('moazebConnectionData', { 
                    moazeb: user.linkedMoazeb.moazebId,
                });
            }

        } catch (error) {
            console.error('❌ خطأ في تهيئة جلسة المستخدم:', error);
        }
    });
    
    // --- End of New Authentication Flow ---

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

                    updatedUser.linkedFriends.forEach(friendId => {
                         if (connectedUsers[friendId]) {
                            io.to(connectedUsers[friendId]).emit('locationUpdate', locationData);
                         }
                    });

                    socket.emit('locationUpdate', locationData);

                    if (updatedUser.linkedMoazeb && updatedUser.linkedMoazeb.moazebId) {
                        const moazeb = await Moazeb.findById(updatedUser.linkedMoazeb.moazebId);
                        if (moazeb) {
                            try {
                                const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/walking/${updatedUser.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${process.env.MAPBOX_ACCESS_TOKEN}`);
                                const connectionLine = routeResponse.data.routes[0].geometry.coordinates;
                                socket.emit('moazebConnectionUpdate', {
                                    moazebId: moazeb._id,
                                    connectionLine: connectionLine
                                });
                            } catch (apiError) {
                                console.error("Mapbox API error:", apiError.message);
                            }
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
            // Merge settings
            const settingsUpdate = { ...user.settings.toObject(), ...data.settings };
            user.settings = settingsUpdate;
            
            // Update top-level fields
            if (data.name !== undefined) user.name = data.name;
            if (data.gender !== undefined) user.gender = data.gender;
            if (data.phone !== undefined) user.phone = data.phone;
            if (data.email !== undefined) user.email = data.email;

            await user.save();
            console.log(`⚙️ تم تحديث إعدادات ${user.name}`);
            socket.emit('user:settings_updated', user);

            if (!user.settings.shareLocation || user.settings.stealthMode) {
                io.emit('removeUserMarker', { userId: user.userId });
            } else {
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
        const { targetUserId, limit = 200 } = data;
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
                .sort({ timestamp: 1 }).limit(limit);
            socket.emit('historicalPathData', { success: true, userId: targetUserId, path: historicalLocations });
        } catch (error) {
            console.error('❌ خطأ في جلب المسار التاريخي:', error);
            socket.emit('historicalPathData', { success: false, message: 'حدث خطأ أثناء جلب المسار.' });
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
            
            const updatedUser = await User.findByIdAndUpdate(
                user._id,
                { $push: { createdPOIs: newPOI._id } },
                { new: true }
            ).populate('createdPOIs');

            user = updatedUser; // Update server-side user object
            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name} بنجاح.` });
            socket.emit('user:session_initialized', user); // Re-send full user data
            io.emit('updatePOIs'); // Tell all clients to refresh POIs

        } catch (error) {
            console.error('❌ خطأ في إضافة POI:', error);
            socket.emit('poiStatus', { success: false, message: 'خطأ في الخادم.' });
        }
    });

    socket.on('deletePOI', async (data) => {
        const { poiId } = data;
        if (!user || !poiId) return;

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
            const updatedUser = await User.findByIdAndUpdate(
                user._id,
                { $pull: { createdPOIs: poiId } },
                { new: true }
            ).populate('createdPOIs');

            user = updatedUser; // Update server-side user object
            socket.emit('poiDeleted', { success: true, message: 'تم الحذف بنجاح.', poiId });
            socket.emit('user:session_initialized', user); // Re-send full user data
            io.emit('updatePOIs'); // Tell all clients to refresh POIs

        } catch (error) {
            console.error('❌ خطأ في حذف POI:', error);
            socket.emit('poiDeleted', { success: false, message: 'خطأ في الخادم.' });
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

    socket.on('getAllMoazeb', async () => {
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
        if (!user || !moazebId) {
            return socket.emit('linkToMoazebStatus', { success: false, message: 'بيانات ناقصة.' });
        }

        try {
            const moazeb = await Moazeb.findById(moazebId);
            if (!moazeb) {
                return socket.emit('linkToMoazebStatus', { success: false, message: 'المضيف غير موجود.' });
            }

            if (!moazeb.linkedUsers.includes(user.userId)) {
                moazeb.linkedUsers.push(user.userId);
                await moazeb.save();
            }

            user.linkedMoazeb = {
                moazebId: moazeb._id,
                linkedAt: new Date()
            };
            await user.save();

            let connectionLine = [];
            try {
                if (user.location && user.location.coordinates && user.location.coordinates.length === 2) {
                     const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/walking/${user.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${process.env.MAPBOX_ACCESS_TOKEN}`);
                     connectionLine = routeResponse.data.routes[0].geometry.coordinates;
                }
            } catch(apiError) {
                console.error("Mapbox API error on linking:", apiError.message);
            }

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
        if (!user || !user.linkedMoazeb) return;

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
            // To update last seen, we should set it on disconnect
            User.findOneAndUpdate({ userId: socket.userId }, { lastSeen: new Date() }).exec();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🔗 افتح متصفحك على: http://localhost:${PORT}`);
});
