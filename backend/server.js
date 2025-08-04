// server.js

require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = 'jsonwebtoken';

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
    userId: { type: String, required: true, unique: true, index: true }, // Will be the phone number
    password: { type: String, required: true },
    name: { type: String, required: true },
    photo: { type: String, default: 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER' },
    linkCode: { type: String, unique: true, sparse: true },
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
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

// Authentication Middleware for Socket.IO
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId; // userId is phone number
            next();
        } catch (err) {
            console.log("Authentication error: Invalid token");
            next(new Error("Authentication error"));
        }
    } else {
        // Allow unauthenticated connections for login/register
        next();
    }
});


io.on('connection', async (socket) => {
    console.log(`📡 مستخدم جديد متصل: ${socket.id}`);

    let user;

    // If connection is authenticated via middleware
    if (socket.userId) {
        console.log(`Authenticated user ${socket.userId} connected.`);
        user = await User.findOne({ userId: socket.userId }).populate('createdPOIs').populate({ path: 'linkedMoazeb.moazebId' });
        if (user) {
            connectedUsers[user.userId] = socket.id;
            socket.emit('authenticationSuccess', { token: socket.handshake.auth.token });
            socket.emit('currentUserData', user);

            if (user.linkedFriends && user.linkedFriends.length > 0) {
                const friendsData = await User.find({ userId: { $in: user.linkedFriends } });
                socket.emit('updateFriendsList', friendsData);
            }

            if (user.linkedMoazeb && user.linkedMoazeb.moazebId) {
                socket.emit('moazebConnectionData', { 
                    moazeb: user.linkedMoazeb.moazebId,
                });
            }
        } else {
            // This case should ideally not happen if token is valid
            socket.emit('authenticationFailed', { message: 'User not found.' });
        }
    } else {
        console.log("An unauthenticated user connected.");
    }
    
    // --- NEW AUTHENTICATION EVENTS ---
    
    socket.on('register', async (data) => {
        const { phone, password, name } = data;
        if (!phone || !password || !name) {
            return socket.emit('authError', { message: 'الرجاء ملء جميع الحقول' });
        }

        try {
            const existingUser = await User.findOne({ userId: phone });
            if (existingUser) {
                return socket.emit('authError', { message: 'رقم الهاتف هذا مسجل بالفعل.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
            
            const newUser = new User({
                userId: phone,
                password: hashedPassword,
                name: name,
                otp: otp,
                otpExpires: otpExpires,
                linkCode: Math.random().toString(36).substring(2, 9).toUpperCase(),
                location: { type: 'Point', coordinates: [0, 0] },
            });
            await newUser.save();
            
            // --- MOCK SMS SENDING ---
            console.log(`[MOCK SMS] OTP for ${phone} is: ${otp}`);
            // In a real application, you would integrate an SMS gateway here.
            // For example: await sendSms(phone, `Your verification code is ${otp}`);
            // --- END MOCK ---
            
            socket.emit('registrationSuccess', { message: `تم إرسال رمز التحقق إلى هاتفك. الرمز هو ${otp} (لأغراض الاختبار).` });

        } catch (error) {
            console.error("Registration error:", error);
            socket.emit('authError', { message: 'حدث خطأ أثناء التسجيل.' });
        }
    });

    socket.on('verify-otp', async (data) => {
        const { phone, otp } = data;
        if (!phone || !otp) {
            return socket.emit('authError', { message: 'بيانات التحقق ناقصة.' });
        }

        try {
            const userToVerify = await User.findOne({ userId: phone });
            if (!userToVerify) {
                return socket.emit('authError', { message: 'المستخدم غير موجود.' });
            }
            if (userToVerify.otp !== otp || userToVerify.otpExpires < new Date()) {
                return socket.emit('authError', { message: 'رمز التحقق غير صحيح أو منتهي الصلاحية.' });
            }

            userToVerify.isVerified = true;
            userToVerify.otp = undefined;
            userToVerify.otpExpires = undefined;
            await userToVerify.save();
            
            const token = jwt.sign({ userId: userToVerify.userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
            
            socket.emit('authenticationSuccess', { token });

        } catch(error) {
            console.error("OTP verification error:", error);
            socket.emit('authError', { message: 'حدث خطأ أثناء التحقق.' });
        }
    });

    socket.on('login', async (data) => {
        const { phone, password } = data;
        if (!phone || !password) {
            return socket.emit('authError', { message: 'الرجاء إدخال رقم الهاتف وكلمة المرور.' });
        }

        try {
            const userToLogin = await User.findOne({ userId: phone });
            if (!userToLogin) {
                return socket.emit('authError', { message: 'رقم الهاتف أو كلمة المرور غير صحيحة.' });
            }

            const isMatch = await bcrypt.compare(password, userToLogin.password);
            if (!isMatch) {
                return socket.emit('authError', { message: 'رقم الهاتف أو كلمة المرور غير صحيحة.' });
            }

            if (!userToLogin.isVerified) {
                 // Resend OTP if not verified
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
                userToLogin.otp = otp;
                userToLogin.otpExpires = otpExpires;
                await userToLogin.save();
                console.log(`[MOCK SMS] New OTP for unverified user ${phone} is: ${otp}`);
                return socket.emit('verificationRequired', { message: `حسابك غير مفعل. تم إرسال رمز تحقق جديد. الرمز هو ${otp} (لأغراض الاختبار).` });
            }

            const token = jwt.sign({ userId: userToLogin.userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

            socket.emit('authenticationSuccess', { token });

        } catch (error) {
            console.error("Login error:", error);
            socket.emit('authError', { message: 'حدث خطأ أثناء تسجيل الدخول.' });
        }
    });


    // --- REGULAR APP EVENTS (PROTECTED BY AUTH) ---
    
    // This is a placeholder for the old 'registerUser' logic.
    // It's now used for updating secondary user info after initial login.
    socket.on('updateInitialInfo', async (data) => {
        if (!socket.userId) return;
        const { name, gender, email, emergencyWhatsapp } = data;
        
        try {
            const userToUpdate = await User.findOne({ userId: socket.userId });
            if (!userToUpdate) return;
            
            if (name && userToUpdate.name !== name) userToUpdate.name = name;
            if (gender && userToUpdate.gender !== gender) userToUpdate.gender = gender;
            if (email && userToUpdate.email !== email) userToUpdate.email = email;
            if (emergencyWhatsapp !== undefined && userToUpdate.settings.emergencyWhatsapp !== emergencyWhatsapp) {
                userToUpdate.settings.emergencyWhatsapp = emergencyWhatsapp;
            }
            userToUpdate.lastSeen = Date.now();
            await userToUpdate.save();

            socket.emit('currentUserData', userToUpdate); // Send back the updated data

        } catch (error) {
            console.error('Error updating initial info:', error);
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
                        phone: updatedUser.userId, // Phone is the userId
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
                                const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving/${updatedUser.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${process.env.MAPBOX_ACCESS_TOKEN}`);
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
            user.settings = { ...user.settings, ...data.settings };
            if (data.name !== undefined) user.name = data.name;
            if (data.gender !== undefined) user.gender = data.gender;
            if (data.email !== undefined) user.email = data.email;

            await user.save();
            console.log(`⚙️ تم تحديث إعدادات ${user.name}:`, user.settings);

            if (!user.settings.shareLocation || user.settings.stealthMode) {
                io.emit('removeUserMarker', { userId: user.userId });
            } else {
                 if (user.location && user.location.coordinates) {
                    const locationData = {
                        userId: user.userId, name: user.name, photo: user.photo,
                        location: user.location.coordinates, battery: user.batteryStatus,
                        settings: user.settings, lastSeen: user.lastSeen, gender: user.gender,
                        phone: user.userId, email: user.email
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
            
            user.createdPOIs.push(newPOI._id);
            await user.save();

            socket.emit('poiStatus', { success: true, message: `✅ تم إضافة ${newPOI.name} بنجاح.` });
            io.emit('updatePOIs');
            socket.emit('currentUserData', await User.findById(user._id).populate('createdPOIs'));

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
            await User.findByIdAndUpdate(
                user._id,
                { $pull: { createdPOIs: poiId } }
            );

            socket.emit('poiDeleted', { success: true, message: 'تم الحذف بنجاح.', poiId });
            io.emit('updatePOIs');
            socket.emit('currentUserData', await User.findById(user._id).populate('createdPOIs'));


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
            socket.emit('moazebSearchResults', { success: false, message: 'خطأ بالخادم' });
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

            let connectionLine = [];
            if (user.location && user.location.coordinates && user.location.coordinates[0] !== 0) {
                 try {
                    const routeResponse = await axios.get(`https://api.mapbox.com/directions/v5/mapbox/driving/${user.location.coordinates.join(',')};${moazeb.location.coordinates.join(',')}?geometries=geojson&access_token=${process.env.MAPBOX_ACCESS_TOKEN}`);
                    connectionLine = routeResponse.data.routes[0].geometry.coordinates;
                 } catch (apiError) {
                    console.error("Mapbox API error on linking:", apiError.message);
                 }
            }

            user.linkedMoazeb = {
                moazebId: moazeb._id,
                linkedAt: new Date(),
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
            socket.emit('linkToMoazebStatus', { success: false, message: 'حدث خطأ في الخادم. قد يكون بسبب عدم توفر مفتاح Mapbox API على الخادم.' });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`🔗 افتح متصفحك على: http://localhost:${PORT}`);
});
