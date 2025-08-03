// script.js

mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

// ====== إعدادات Mapbox ======
mapboxgl.accessToken = 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [43.6875, 33.3152],
    zoom: 6,
    pitch: 45, // ميل افتراضي 3D
    bearing: -17.6 // دوران افتراضي 3D
});

// ====== متغيرات عامة ======
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
let meetingPointMarker = null; // ** جديد: لتتبع مركر نقطة التجمع
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};

// المواقع الرئيسية في العراق (فارغة بناءً على طلبك)
const holySites = [];

// اتصال Socket.IO
// const socket = io('http://localhost:3000'); // للتجربة المحلية
const socket = io('https://tareeqaljannah-app.onrender.com'); // للنسخة المنشورة


// ====== وظائف عامة للواجهة الرسومية (UI Helpers) ======

function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    document.querySelectorAll('.main-header nav button').forEach(btn => {
        btn.classList.remove('active');
    });

    if (panelId) {
        const targetPanel = document.getElementById(panelId);
        if (targetPanel) {
            targetPanel.classList.add('active');
            const activeBtn = document.querySelector(`button[id$="${panelId.replace('Panel', 'Btn')}"]`);
            if (activeBtn) {
                activeBtn.classList.add('active');
            }
        }
    }
}

// هذه الوظيفة تربط معالجات أحداث الإغلاق
document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('showGeneralMapBtn').classList.add('active');
        showGeneralMap();
    });
});

// ====== وظائف الخريطة والمواقع (Map & Location Functions) ======

function createCustomMarker(user) {
    if (!user || !user.location || !user.location.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        console.warn("بيانات الموقع غير صالحة لإنشاء مركر:", user);
        return null;
    }

    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].remove();
    }

    const el = document.createElement('div');
    el.className = 'mapboxgl-marker';

    if (currentUser && user.userId === currentUser.userId) {
        el.classList.add('current-user-marker');
    } else {
        el.classList.add('friend-marker');
    }

    if (currentUser && user.userId === currentUser.userId && currentUser.settings.stealthMode) {
        el.classList.add('stealth-mode');
    }

    const userPhotoSrc = user.photo && user.photo !== '' ? user.photo : 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER';

    el.innerHTML = `
        <img class="user-marker-photo" src="${userPhotoSrc}" alt="${user.name}">
        <div class="user-marker-name">${user.name}</div>
        <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(user.location.coordinates)
        .addTo(map);

    if (currentUser && user.userId !== currentUser.userId) {
        marker.getElement().addEventListener('click', () => {
            showFriendDetailsPopup(user);
        });
    }

    friendMarkers[user.userId] = marker;
    return marker;
}

function showFriendDetailsPopup(friend) {
    const existingPopup = friendMarkers[friend.userId]?._popup;
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const currentUserHasValidLocation = currentUser && currentUser.location && currentUser.location.coordinates && (currentUser.location.coordinates[0] !== 0 || currentUser.location.coordinates[1] !== 0);
    const friendHasValidLocation = friend && friend.location && friend.location.coordinates && (friend.location.coordinates[0] !== 0 || friend.location.coordinates[1] !== 0);

    let distanceHtml = '';
    if (currentUserHasValidLocation && friendHasValidLocation) {
        const distance = calculateDistance(
            currentUser.location.coordinates[1], currentUser.location.coordinates[0],
            friend.location.coordinates[1], friend.location.coordinates[0]
        ).toFixed(2);
        distanceHtml = `<p><i class="fas fa-route"></i> المسافة عنك: ${distance} كم</p>`;
    } else {
        distanceHtml = '<p><i class="fas fa-route"></i> المسافة عنك: موقع غير محدد</p>';
    }
    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'غير معروف';

    const friendDetailsHtml = `
        ${friend.gender && friend.gender !== 'other' ? `<p><i class="fas fa-venus-mars"></i> الجنس: ${friend.gender === 'male' ? 'ذكر' : 'أنثى'}</p>` : ''}
        ${friend.phone ? `<p><i class="fas fa-phone"></i> الهاتف: ${friend.phone}</p>` : ''}
        ${friend.email ? `<p><i class="fas fa-envelope"></i> البريد: ${friend.email}</p>` : ''}
    `;

    const popupContent = `
        <h3>${friend.name}</h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        ${distanceHtml}
        <p><i class="fas fa-clock"></i> آخر ظهور: ${lastSeenTime}</p>
        ${friendDetailsHtml}
        <div style="display: flex; justify-content: space-around; margin-top: 10px;">
            <button id="unfriendBtn-${friend.userId}" class="unfriend-btn"><i class="fas fa-user-minus"></i> إلغاء الارتباط</button>
            <button id="chatFriendBtn-${friend.userId}" class="chat-friend-btn"><i class="fas fa-comments"></i> دردشة</button>
        </div>
    `;

    const popup = new mapboxgl.Popup({ offset: 25 })
        .setLngLat(friend.location.coordinates)
        .setHTML(popupContent)
        .addTo(map);

    popup.on('open', () => {
        document.getElementById(`unfriendBtn-${friend.userId}`).addEventListener('click', () => {
            if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friend.name}؟`)) {
                socket.emit('unfriendUser', { friendId: friend.userId });
                popup.remove();
            }
        });
        document.getElementById(`chatFriendBtn-${friend.userId}`).addEventListener('click', () => {
            currentChatFriendId = friend.userId;
            setupBottomChatBar();
            document.getElementById('bottomChatBar').classList.add('active');
            popup.remove();
        });
    });
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) {
        return null;
    }

    if (poiMarkers[poi._id]) {
        poiMarkers[poi._id].remove();
    }

    const el = document.createElement('div');
    el.className = 'poi-marker';
    // ** تحديث: استخدام الأيقونة من الخادم مباشرة
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || ''}</p>
            <p>الفئة: ${poi.category}</p>
            <p>بواسطة: ${poi.createdBy}</p>
        `))
        .addTo(map);

    poiMarkers[poi._id] = marker;
    return marker;
}

// ** جديد: وظيفة لإنشاء مركر نقطة التجمع
function createMeetingPointMarker(data) {
    if (meetingPointMarker) {
        meetingPointMarker.remove();
    }
    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;
    meetingPointMarker = new mapboxgl.Marker(el)
        .setLngLat(data.point.location.coordinates)
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>نقطة التجمع: ${data.point.name}</h3><p>بواسطة: ${data.creatorName}</p>`))
        .addTo(map);
    
    // ** جديد: تحديث واجهة المستخدم لإظهار زر الإنهاء
    if(currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').disabled = true;
    }
}

// ** جديد: وظيفة لإزالة مركر نقطة التجمع
function clearMeetingPointMarker() {
    if (meetingPointMarker) {
        meetingPointMarker.remove();
        meetingPointMarker = null;
    }
    document.getElementById('endMeetingPointBtn').style.display = 'none';
    document.getElementById('setMeetingPointBtn').style.display = 'block';
    document.getElementById('meetingPointInput').disabled = false;
    document.getElementById('meetingPointInput').value = '';
}


function showGeneralMap() {
    for (const userId in friendMarkers) {
        if (friendMarkers[userId]) friendMarkers[userId].remove();
    }
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath();
    // لا نمسح نقطة التجمع لأنها تظهر في كل الخرائط

    holySites.forEach(site => {
        // ... (المنطق الحالي للمواقع المقدسة يبقى كما هو)
    });

    socket.emit('requestPOIs');

    map.flyTo({
        center: [43.6875, 33.3152],
        zoom: 6,
        pitch: 45,
        bearing: -17.6
    });
}

function showFriendsMap() {
    holySites.forEach(site => {
        if (site.marker) site.marker.remove();
    });
    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath();
    // لا نمسح نقطة التجمع

    for (const userId in friendMarkers) {
        if (friendMarkers[userId]) friendMarkers[userId].remove();
        if (map.getSource(`line-${userId}`)) {
             map.removeLayer(`line-${userId}`);
             map.removeSource(`line-${userId}`);
        }
    }
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
    }
    
    linkedFriends.forEach(friend => {
        if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });
    
    // ضبط عرض الخريطة لتشمل الجميع
    if (currentUser) {
        const visibleUsers = [currentUser, ...linkedFriends].filter(u => u.settings && u.settings.shareLocation && !u.settings.stealthMode && u.location && u.location.coordinates[0] !== 0);
        if (visibleUsers.length > 1) {
            const bounds = new mapboxgl.LngLatBounds();
            visibleUsers.forEach(u => bounds.extend(u.location.coordinates));
            map.fitBounds(bounds, { padding: 80, pitch: 45, bearing: -17.6 });
        } else if (visibleUsers.length === 1) {
            map.flyTo({ center: visibleUsers[0].location.coordinates, zoom: 14, pitch: 45, bearing: -17.6 });
        }
    }
}

function clearHistoricalPath() {
    if (currentHistoricalPathLayer && map.getLayer(currentHistoricalPathLayer)) {
        map.removeLayer(currentHistoricalPathLayer);
        map.removeSource(currentHistoricalPathLayer);
        currentHistoricalPathLayer = null;
    }
}

function drawHistoricalPath(userId, pathCoordinates) {
    clearHistoricalPath();

    if (pathCoordinates.length < 2) {
        console.warn("لا توجد نقاط كافية لرسم المسار التاريخي.");
        return;
    }

    const layerId = `historical-path-${userId}`;
    currentHistoricalPathLayer = layerId;

    map.addSource(layerId, {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates }
        }
    });

    map.addLayer({
        'id': layerId, 'type': 'line', 'source': layerId,
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': { 'line-color': '#FF00FF', 'line-width': 6, 'line-opacity': 0.8 }
    });

    const bounds = new mapboxgl.LngLatBounds();
    pathCoordinates.forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, { padding: 50 });
}


function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ====== نظام تحديد المواقع (GPS) ======
function startLocationTracking() {
    if (!navigator.geolocation) {
        alert("متصفحك لا يدعم تحديد المواقع.");
        return;
    }
    if (!currentUser) {
        console.warn("لا يمكن بدء تتبع الموقع: بيانات المستخدم غير متاحة بعد.");
        return;
    }

    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', {
                location: [longitude, latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => { console.error("خطأ في تحديد الموقع:", error); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function getBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            return (battery.level * 100).toFixed(0) + '%';
        } catch (e) { return 'N/A'; }
    }
    return 'N/A';
}

function playNotificationSound() {
    if (currentUser && currentUser.settings.sound) {
        const audio = new Audio('https://www.soundjay.com/buttons/beep-07.mp3');
        audio.play().catch(e => console.error("Error playing sound:", e));
    }
}

function playSOSSound() {
    if (currentUser && currentUser.settings.sound) {
        const audio = new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3');
        audio.play().catch(e => console.error("Error playing sound:", e));
    }
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId || !messageText) return;

    socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });

    if (document.getElementById('chatPanel').classList.contains('active')) {
         addChatMessage(currentUser.name, messageText, 'sent', new Date());
    }
    if (currentUser.settings.sound) playNotificationSound();
    if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, messageText);
    
    document.getElementById('bottomChatInput').value = '';
}

function addChatMessage(senderName, messageText, type = '', timestamp = new Date()) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    const timeString = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="message-meta">${senderName} - ${timeString}</span><br>${messageText}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble) {
        if (activeMessageTimers[userId]) clearTimeout(activeMessageTimers[userId]);
        bubble.textContent = messageText;
        bubble.classList.add('show');
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 5000);
    }
}

function updateFriendBatteryStatus() {
    const list = document.getElementById('friendBatteryStatus');
    list.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const li = document.createElement('li');
            li.textContent = `${friend.name}: ${friend.batteryStatus || 'N/A'}`;
            list.appendChild(li);
        });
    } else {
        list.innerHTML = '<li>لا يوجد أصدقاء مرتبطون.</li>';
    }
}

// ** جديد: وظيفة حقيقية لجلب أوقات الصلاة
function fetchAndDisplayPrayerTimes() {
    const displayElement = document.getElementById('prayerTimesDisplay');
    displayElement.innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';
    socket.emit('requestPrayerTimes');
}

function setupChatPanel() {
    const chatFriendSelect = document.getElementById('chatFriendSelect');
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatFriendSelect.innerHTML = '';

    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            chatFriendSelect.appendChild(option);
        });
        currentChatFriendId = document.getElementById('bottomChatFriendSelect').value || linkedFriends[0].userId;
        chatFriendSelect.value = currentChatFriendId;

        chatMessagesDiv.innerHTML = '<p>جاري تحميل الرسائل...</p>';
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        currentChatFriendId = null;
        chatMessagesDiv.innerHTML = '<p>لا يوجد أصدقاء للدردشة.</p>';
    }

    chatFriendSelect.removeEventListener('change', handleChatFriendChange);
    chatFriendSelect.addEventListener('change', handleChatFriendChange);
}

function handleChatFriendChange(e) {
    currentChatFriendId = e.target.value;
    document.getElementById('bottomChatFriendSelect').value = currentChatFriendId;
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = '<p>جاري تحميل الرسائل...</p>';
    socket.emit('requestChatHistory', { friendId: currentChatFriendId });
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const bottomChatFriendSelect = document.getElementById('bottomChatFriendSelect');
    
    bottomChatFriendSelect.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            bottomChatFriendSelect.appendChild(option);
        });
        
        currentChatFriendId = linkedFriends[0].userId;
        bottomChatFriendSelect.value = currentChatFriendId;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
        currentChatFriendId = null;
    }

    bottomChatFriendSelect.onchange = (e) => {
        currentChatFriendId = e.target.value;
    };
}

// ====== التعامل مع أحداث WebSocket من الخادم ======

socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const registrationData = {
        userId,
        name: localStorage.getItem('appUserName'),
        photo: localStorage.getItem('appUserPhoto'),
        gender: localStorage.getItem('appUserGender'),
        phone: localStorage.getItem('appUserPhone'),
        email: localStorage.getItem('appUserEmail'),
        emergencyWhatsapp: localStorage.getItem('appEmergencyWhatsapp')
    };
    socket.emit('registerUser', registrationData);
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('تم استقبال بيانات المستخدم الحالي:', currentUser);

    localStorage.setItem('appUserId', currentUser.userId);
    localStorage.setItem('appUserName', currentUser.name);
    localStorage.setItem('appUserPhoto', currentUser.photo);
    localStorage.setItem('appUserGender', currentUser.gender || 'other');
    localStorage.setItem('appUserPhone', currentUser.phone || '');
    localStorage.setItem('appUserEmail', currentUser.email || '');
    localStorage.setItem('appEmergencyWhatsapp', currentUser.settings.emergencyWhatsapp || '');

    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo;
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    document.getElementById('editUserNameInput').value = currentUser.name;
    document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';
    document.getElementById('editGenderSelect').value = currentUser.gender || 'other';
    document.getElementById('editPhoneInput').value = currentUser.phone || '';
    document.getElementById('editEmailInput').value = currentUser.email || '';
    
    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;
    
    startLocationTracking();

    if (currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }

    // ** جديد: إظهار لوحة المعلومات الأولية إذا كانت البيانات غير مكتملة
    if (!currentUser.name || currentUser.name.startsWith('مستخدم_') || !currentUser.phone || !currentUser.email || !currentUser.gender || currentUser.gender === 'other') {
        document.getElementById('initialInfoPanel').classList.add('active');
        document.getElementById('initialInfoNameInput').value = currentUser.name.startsWith('مستخدم_') ? '' : currentUser.name;
        document.getElementById('initialInfoGenderSelect').value = currentUser.gender || 'other';
        document.getElementById('initialInfoPhoneInput').value = currentUser.phone || '';
        document.getElementById('initialInfoEmailInput').value = currentUser.email || '';
    } else {
        document.getElementById('initialInfoPanel').classList.remove('active');
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (currentUser && data.userId === currentUser.userId) {
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
    }
    
    if (userToUpdate) {
        Object.assign(userToUpdate, data);
        if (!userToUpdate.settings.shareLocation || userToUpdate.settings.stealthMode) {
            if (friendMarkers[userToUpdate.userId]) {
                friendMarkers[userToUpdate.userId].remove();
                delete friendMarkers[userToUpdate.userId];
            }
        } else {
            createCustomMarker(userToUpdate);
        }
    }
    updateFriendBatteryStatus();
});

socket.on('linkStatus', (data) => {
    alert(data.message);
    if (data.success) {
        togglePanel(null);
        document.getElementById('showFriendsMapBtn').click();
    }
});

socket.on('unfriendStatus', (data) => {
    alert(data.message);
    if (data.success) {
        document.getElementById('showFriendsMapBtn').click();
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    console.log('تم تحديث قائمة الأصدقاء:', linkedFriends);

    showFriendsMap();
    setupBottomChatBar();

    const friendsListEl = document.getElementById('friendsList');
    friendsListEl.innerHTML = '';
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;">
                <span>${friend.name}</span>
                <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}" style="margin-right: auto; background: #dc3545; color: white; border: none; padding: 3px 8px; border-radius: 5px; cursor: pointer;"><i class="fas fa-user-minus"></i></button>
            `;
            friendsListEl.appendChild(li);
        });
        document.querySelectorAll('.unfriend-in-list-btn').forEach(btn => {
            btn.onclick = (e) => {
                const friendId = e.currentTarget.dataset.friendId;
                if (confirm(`هل أنت متأكد من إلغاء الارتباط؟`)) {
                    socket.emit('unfriendUser', { friendId });
                }
            };
        });
    } else {
        friendsListEl.innerHTML = '<li>لا يوجد أصدقاء مرتبطون.</li>';
    }
    updateFriendBatteryStatus();
});

socket.on('newChatMessage', (data) => {
    if (currentUser && data.receiverId === currentUser.userId) {
        if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message);
        if (currentUser.settings.sound) playNotificationSound();
        if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(data.senderName, data.message, 'received', data.timestamp);
        }
    }
});

socket.on('removeUserMarker', (data) => {
    if (friendMarkers[data.userId]) {
        friendMarkers[data.userId].remove();
        delete friendMarkers[data.userId];
    }
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if (data.success) socket.emit('requestPOIs');
});

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(poi => createPOIMarker(poi));
});

socket.on('historicalPathData', (data) => {
    if (data.success) {
        if (data.path && data.path.length > 0) {
            const coordinates = data.path.map(loc => loc.location.coordinates);
            drawHistoricalPath(data.userId, coordinates);
            alert(`تم عرض المسار التاريخي.`);
            togglePanel(null);
            document.getElementById('showFriendsMapBtn').classList.add('active');
            showFriendsMap();
        } else {
            alert(`لا توجد بيانات مسار تاريخي لهذا المستخدم.`);
        }
    } else {
        alert(`فشل جلب المسار: ${data.message}`);
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (!chatMessagesDiv) return;
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history.length > 0) {
        data.history.forEach(msg => {
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const name = (type === 'sent') ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(name, msg.message, type, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p>لا توجد رسائل سابقة.</p>';
    }
});

// ** جديد: معالجة أحداث نقاط التجمع
socket.on('newMeetingPoint', (data) => {
    createMeetingPointMarker(data);
    alert(`${data.creatorName} قام بإنشاء نقطة تجمع جديدة.`);
});

socket.on('meetingPointCleared', (data) => {
    clearMeetingPointMarker();
    alert(`تم إنهاء نقطة التجمع.`);
});

// ** جديد: معالجة أحداث قسم المعزب
socket.on('moazebStatus', (data) => {
    alert(data.message);
});

socket.on('moazebSearchResults', (data) => {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = '';
    if (data.success && data.results.length > 0) {
        data.results.forEach(moazeb => {
            const card = document.createElement('div');
            card.className = 'moazeb-card';
            card.innerHTML = `
                <h4>${moazeb.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
                <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
                <p><i class="fas fa-globe-asia"></i> ${moazeb.governorate} - ${moazeb.district}</p>
            `;
            container.appendChild(card);
        });
    } else {
        container.innerHTML = '<p>لم يتم العثور على نتائج.</p>';
    }
});

// ** جديد: معالجة أحداث أوقات الصلاة
socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        const timings = data.timings;
        displayElement.innerHTML = `
            <p><strong>الفجر:</strong> ${timings.Fajr}</p>
            <p><strong>الظهر:</strong> ${timings.Dhuhr}</p>
            <p><strong>العصر:</strong> ${timings.Asr}</p>
            <p><strong>المغرب:</strong> ${timings.Maghrib}</p>
            <p><strong>العشاء:</strong> ${timings.Isha}</p>
        `;
    } else {
        displayElement.innerHTML = `<p>${data.message || 'فشل تحميل أوقات الصلاة.'}</p>`;
    }
});


map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
});

document.addEventListener('DOMContentLoaded', () => {

    // ربط الأزرار الرئيسية بالوظائف
    document.getElementById('showGeneralMapBtn').onclick = () => { togglePanel(null); showGeneralMap(); };
    document.getElementById('showFriendsMapBtn').onclick = () => { togglePanel(null); showFriendsMap(); };
    document.getElementById('showProfileBtn').onclick = () => togglePanel('profilePanel');
    document.getElementById('showConnectBtn').onclick = () => togglePanel('connectPanel');
    document.getElementById('showFeaturesBtn').onclick = () => {
        togglePanel('featuresPanel');
        if (currentUser) {
            const select = document.getElementById('historicalPathUserSelect');
            select.innerHTML = `<option value="${currentUser.userId}">${currentUser.name} (أنا)</option>`;
            linkedFriends.forEach(f => select.innerHTML += `<option value="${f.userId}">${f.name}</option>`);
        }
        updateFriendBatteryStatus();
        fetchAndDisplayPrayerTimes();
    };
    document.getElementById('showSettingsBtn').onclick = () => togglePanel('settingsPanel');
    document.getElementById('showMoazebBtn').onclick = () => togglePanel('moazebPanel'); // ** جديد

    // لوحة المعلومات الأولية
    document.getElementById('initialInfoConfirmBtn').onclick = () => {
        const data = {
            name: document.getElementById('initialInfoNameInput').value.trim(),
            gender: document.getElementById('initialInfoGenderSelect').value,
            phone: document.getElementById('initialInfoPhoneInput').value.trim(),
            email: document.getElementById('initialInfoEmailInput').value.trim()
        };
        if (data.name && data.gender !== 'other' && data.phone && data.email) {
            Object.keys(data).forEach(key => localStorage.setItem(`appUser${key.charAt(0).toUpperCase() + key.slice(1)}`, data[key]));
            socket.emit('updateSettings', data);
            document.getElementById('initialInfoPanel').classList.remove('active');
            alert('تم حفظ معلوماتك.');
        } else {
            alert('الرجاء ملء جميع الحقول.');
        }
    };
    
    // لوحة الملف الشخصي
    document.getElementById('copyLinkCodeBtn').onclick = () => navigator.clipboard.writeText(document.getElementById('userLinkCode').textContent).then(() => alert('تم نسخ الرمز.'));
    document.getElementById('updateProfileInfoBtn').onclick = () => {
        const data = {
            name: document.getElementById('editUserNameInput').value.trim(),
            gender: document.getElementById('editGenderSelect').value,
            phone: document.getElementById('editPhoneInput').value.trim(),
            email: document.getElementById('editEmailInput').value.trim()
        };
        if (data.name && data.gender !== 'other' && data.phone && data.email) {
            socket.emit('updateSettings', data);
            alert('تم حفظ التغييرات.');
        } else {
            alert('الرجاء ملء جميع الحقول.');
        }
    };

    // لوحة الربط
    document.getElementById('connectFriendBtn').onclick = () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if (friendCode) socket.emit('requestLink', { friendCode });
        document.getElementById('friendCodeInput').value = '';
    };

    // شريط وشاشة الدردشة
    document.getElementById('bottomChatSendBtn').onclick = sendMessageFromBottomBar;
    document.getElementById('bottomChatInput').onkeypress = (e) => e.key === 'Enter' && sendMessageFromBottomBar();
    document.getElementById('toggleChatHistoryBtn').onclick = () => {
        if (!currentUser || linkedFriends.length === 0) {
            alert("اربط حساب صديق أولاً للدردشة.");
            return;
        }
        togglePanel('chatPanel');
        setupChatPanel();
    };

    // لوحة الميزات
    document.getElementById('viewHistoricalPathBtn').onclick = () => {
        const targetUserId = document.getElementById('historicalPathUserSelect').value;
        if (targetUserId) socket.emit('requestHistoricalPath', { targetUserId });
    };
    document.getElementById('clearHistoricalPathBtn').onclick = () => { clearHistoricalPath(); alert('تم مسح المسار.'); };
    
    // ** جديد: تفعيل نقطة التجمع
    document.getElementById('setMeetingPointBtn').onclick = () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (!name) return alert("أدخل اسمًا لنقطة التجمع.");
        if (!currentUser || !currentUser.location.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح لتحديد نقطة التجمع.");
        }
        socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
    };
    // ** جديد: إنهاء نقطة التجمع
    document.getElementById('endMeetingPointBtn').onclick = () => {
        if (confirm("هل أنت متأكد من إنهاء نقطة التجمع للجميع؟")) {
            socket.emit('clearMeetingPoint');
        }
    };
    
    // ** جديد: تحديث منطق إضافة POI
    const poiCategorySelect = document.getElementById('poiCategorySelect');
    const categories = ['Rest Area', 'Medical Post', 'Food Station', 'Water', 'Mosque', 'Parking', 'Info', 'Other'];
    const categoriesAr = {
        'Rest Area': 'استراحة', 'Medical Post': 'نقطة طبية', 'Food Station': 'طعام',
        'Water': 'ماء', 'Mosque': 'مسجد', 'Parking': 'موقف سيارات', 'Info': 'معلومات', 'Other': 'أخرى'
    };
    categories.forEach(cat => poiCategorySelect.innerHTML += `<option value="${cat}">${categoriesAr[cat]}</option>`);

    document.getElementById('addPoiBtn').onclick = () => {
        const name = prompt("أدخل اسم نقطة الاهتمام:");
        if (!name) return;
        if (!currentUser || !currentUser.location.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح.");
        }
        const poiData = {
            name,
            description: prompt("أدخل وصفاً (اختياري):"),
            category: poiCategorySelect.value,
            location: currentUser.location.coordinates
        };
        socket.emit('addCommunityPOI', poiData);
    };

    document.getElementById('refreshPrayerTimesBtn').onclick = fetchAndDisplayPrayerTimes;
    document.getElementById('mapPitch').oninput = (e) => map.setPitch(e.target.value);
    document.getElementById('mapBearing').oninput = (e) => map.setBearing(e.target.value);

    // ** جديد: لوحة المعزب
    document.getElementById('addMoazebBtn').onclick = () => {
        const data = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
        };
        if (!data.name || !data.address || !data.phone || !data.governorate || !data.district) {
            return alert("الرجاء ملء جميع حقول المضيف.");
        }
        if (!currentUser || !currentUser.location.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح لإضافة المضيف.");
        }
        data.location = currentUser.location.coordinates;
        socket.emit('addMoazeb', data);
    };

    document.getElementById('searchMoazebBtn').onclick = () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim(),
        };
        // إزالة المفاتيح الفارغة من كائن البحث
        Object.keys(query).forEach(key => query[key] === '' && delete query[key]);
        if (Object.keys(query).length === 0) return alert("أدخل معيارًا واحدًا للبحث على الأقل.");
        socket.emit('searchMoazeb', query);
    };


    // لوحة الإعدادات
    document.getElementById('shareLocationToggle').onchange = (e) => socket.emit('updateSettings', { shareLocation: e.target.checked });
    document.getElementById('soundToggle').onchange = (e) => socket.emit('updateSettings', { sound: e.target.checked });
    document.getElementById('hideBubblesToggle').onchange = (e) => socket.emit('updateSettings', { hideBubbles: e.target.checked });
    document.getElementById('stealthModeToggle').onchange = (e) => socket.emit('updateSettings', { stealthMode: e.target.checked });
    document.getElementById('updateEmergencyWhatsappBtn').onclick = () => {
        const emergencyWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        if (emergencyWhatsapp) {
            localStorage.setItem('appEmergencyWhatsapp', emergencyWhatsapp);
            socket.emit('updateSettings', { emergencyWhatsapp });
            alert('تم حفظ رقم الطوارئ.');
        }
    };
    
    // زر الطوارئ
    document.getElementById('sosButton').onclick = () => {
        if (!currentUser) return;
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp) return alert("أضف رقم واتساب للطوارئ في الإعدادات أولاً.");
        if (confirm("هل تريد إرسال رسالة استغاثة إلى رقم الطوارئ؟")) {
            playSOSSound();
            const lat = currentUser.location?.coordinates[1] || 'غير محدد';
            const lng = currentUser.location?.coordinates[0] || '';
            const message = `مساعدة عاجلة! أنا ${currentUser.name} بحاجة للمساعدة.\nموقعي: https://www.google.com/maps?q=${lat},${lng}`;
            window.open(`https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`, '_blank');
        }
    };
});
