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
    pitch: 45,
    bearing: -17.6
});

// ====== متغيرات عامة ======
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};
let meetingPointMarker = null; // لتخزين مركر نقطة التجمع

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

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.getElementById('showGeneralMapBtn').classList.add('active');
    });
});

// ====== وظائف الخريطة والمواقع (Map & Location Functions) ======

function createCustomMarker(user) {
    if (!user || !user.location || !user.location.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
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
    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'غير معروف';

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
    if (!poi || !poi.location || !poi.location.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || ''}</p>
            <p>الفئة: ${poi.category}</p>
        `))
        .addTo(map);

    poiMarkers[poi._id] = marker;
    return marker;
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
    clearMeetingPointMarker(); // مسح نقطة التجمع عند العودة للخريطة العامة

    socket.emit('requestPOIs');

    map.flyTo({ center: [43.6875, 33.3152], zoom: 6 });
}

function showFriendsMap() {
    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath();
    
    for (const userId in friendMarkers) {
        if (friendMarkers[userId]) friendMarkers[userId].remove();
    }
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
    }
    
    linkedFriends.forEach(friend => {
        if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
        // إظهار نقطة التجمع الخاصة بالصديق
        if (friend.meetingPoint && friend.meetingPoint.name) {
             drawMeetingPoint({
                creatorId: friend.userId,
                creatorName: friend.name,
                point: friend.meetingPoint
            });
        }
    });

    if (currentUser.meetingPoint && currentUser.meetingPoint.name) {
        drawMeetingPoint({
            creatorId: currentUser.userId,
            creatorName: currentUser.name,
            point: currentUser.meetingPoint
        });
    }
}

function drawConnectionLine(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords) return;
    const geojson = {
        'type': 'Feature',
        'properties': {},
        'geometry': { 'type': 'LineString', 'coordinates': [startCoords, endCoords] }
    };
    if (map.getSource(layerId)) {
        map.getSource(layerId).setData(geojson);
    } else {
        map.addSource(layerId, { 'type': 'geojson', 'data': geojson });
        map.addLayer({
            'id': layerId, 'type': 'line', 'source': layerId,
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 'line-color': '#007bff', 'line-width': 4, 'line-dasharray': [0.5, 2] }
        });
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
    if (pathCoordinates.length < 2) return;
    const layerId = `historical-path-${userId}`;
    currentHistoricalPathLayer = layerId;
    map.addSource(layerId, {
        'type': 'geojson',
        'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates } }
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
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function startLocationTracking() {
    if (!navigator.geolocation) return alert("متصفحك لا يدعم تحديد المواقع.");
    if (!currentUser) return;
    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', {
                userId: currentUser.userId,
                location: [longitude, latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => console.error("خطأ في تحديد الموقع:", error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function getBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            return `${(battery.level * 100).toFixed(0)}%`;
        } catch (e) { return 'N/A'; }
    }
    return 'N/A';
}

function playNotificationSound() {
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(console.error);
}

function playSOSSound() {
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3').play().catch(console.error);
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId) return alert("اختر صديق للدردشة أولاً.");
    if (messageText) {
        if (document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(currentUser.name, messageText, 'sent', new Date());
        }
        socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
        if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, messageText);
        document.getElementById('bottomChatInput').value = '';
    }
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
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 15000); // 15 ثانية
    }
}

function updateFriendBatteryStatus() {
    const list = document.getElementById('friendBatteryStatus');
    list.innerHTML = linkedFriends.length > 0
        ? linkedFriends.map(friend => `<li>${friend.name}: ${friend.batteryStatus || 'N/A'}</li>`).join('')
        : '<li>لا يوجد أصدقاء مرتبطون.</li>';
}

function fetchAndDisplayPrayerTimes() {
    document.getElementById('prayerTimesDisplay').innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';
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
    chatFriendSelect.onchange = handleChatFriendChange;
}

function handleChatFriendChange(e) {
    currentChatFriendId = e.target.value;
    document.getElementById('bottomChatFriendSelect').value = currentChatFriendId;
    document.getElementById('chatMessages').innerHTML = '<p>جاري تحميل الرسائل...</p>';
    socket.emit('requestChatHistory', { friendId: currentChatFriendId });
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const bottomChatFriendSelect = document.getElementById('bottomChatFriendSelect');
    if (linkedFriends.length > 0) {
        bottomChatFriendSelect.innerHTML = linkedFriends.map(f => `<option value="${f.userId}">${f.name}</option>`).join('');
        currentChatFriendId = linkedFriends[0].userId;
        bottomChatFriendSelect.value = currentChatFriendId;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
        currentChatFriendId = null;
    }
    bottomChatFriendSelect.onchange = (e) => currentChatFriendId = e.target.value;
}

function drawMeetingPoint(data) {
    if (meetingPointMarker) meetingPointMarker.remove();
    if (!data?.point?.location?.coordinates?.length) return;
    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;
    meetingPointMarker = new mapboxgl.Marker(el)
        .setLngLat(data.point.location.coordinates)
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>نقطة تجمع: ${data.point.name}</h3><p>أنشأها: ${data.creatorName}</p>`))
        .addTo(map);
}

function clearMeetingPointMarker() {
    if (meetingPointMarker) {
        meetingPointMarker.remove();
        meetingPointMarker = null;
    }
}

function displayMoazebResults(results) {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = !results?.length ? '<p class="feature-info">لا توجد نتائج.</p>' :
        results.map(moazeb => `
            <div class="moazeb-card">
                <h4>${moazeb.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
                <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
                <p><i class="fas fa-globe-asia"></i> ${moazeb.governorate} - ${moazeb.district}</p>
            </div>
        `).join('');
}

// ====== التعامل مع أحداث WebSocket ======
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId') || 'user_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('appUserId', userId);
    socket.emit('registerUser', {
        userId,
        name: localStorage.getItem('appUserName'),
        photo: localStorage.getItem('appUserPhoto'),
        gender: localStorage.getItem('appUserGender'),
        phone: localStorage.getItem('appUserPhone'),
        email: localStorage.getItem('appUserEmail'),
        emergencyWhatsapp: localStorage.getItem('appEmergencyWhatsapp')
    });
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    Object.keys(user).forEach(key => localStorage.setItem(`appUser${key.charAt(0).toUpperCase() + key.slice(1)}`, user[key]));
    Object.keys(user.settings).forEach(key => localStorage.setItem(`app${key.charAt(0).toUpperCase() + key.slice(1)}`, user.settings[key]));

    document.getElementById('userName').textContent = user.name;
    document.getElementById('userPhoto').src = user.photo;
    document.getElementById('userLinkCode').textContent = user.linkCode;
    // ... تحديث بقية الواجهة ...
    
    if (user.meetingPoint && user.meetingPoint.name) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').value = user.meetingPoint.name;
    } else {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
    }

    startLocationTracking();
    if (user.linkedFriends?.length) socket.emit('requestFriendsData', { friendIds: user.linkedFriends });
});

socket.on('locationUpdate', (data) => {
    let userToUpdate = (currentUser && data.userId === currentUser.userId) ? currentUser : linkedFriends.find(f => f.userId === data.userId);
    if (userToUpdate) {
        Object.assign(userToUpdate, data);
        userToUpdate.location.coordinates = data.location; // تصحيح
        if (!userToUpdate.settings.shareLocation || userToUpdate.settings.stealthMode) {
            if (friendMarkers[userToUpdate.userId]) {
                friendMarkers[userToUpdate.userId].remove();
                delete friendMarkers[userToUpdate.userId];
            }
        } else {
            createCustomMarker(userToUpdate);
        }
    }
});

socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        displayElement.innerHTML = Object.entries(data.timings)
            .filter(([key]) => ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].includes(key))
            .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`).join('');
    } else {
        displayElement.innerHTML = `<p style="color:red;">${data.message}</p>`;
    }
});

socket.on('newMeetingPoint', (data) => {
    drawMeetingPoint(data);
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        alert(`تم تحديد نقطة التجمع "${data.point.name}".`);
    }
});

socket.on('meetingPointCleared', (data) => {
    clearMeetingPointMarker();
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
        document.getElementById('meetingPointInput').value = '';
        alert('تم إنهاء نقطة التجمع.');
    }
});

socket.on('moazebStatus', (data) => {
    alert(data.message);
    if(data.success) ['addMoazebName', 'addMoazebAddress', 'addMoazebPhone', 'addMoazebGov', 'addMoazebDist'].forEach(id => document.getElementById(id).value = '');
});

socket.on('moazebSearchResults', (data) => data.success ? displayMoazebResults(data.results) : alert('خطأ في البحث.'));

socket.on('linkStatus', (data) => {
    alert(data.message);
    if(data.success) document.getElementById('showFriendsMapBtn').click();
});

socket.on('unfriendStatus', (data) => {
    alert(data.message);
    if(data.success) document.getElementById('showFriendsMapBtn').click();
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    showFriendsMap();
    setupBottomChatBar();
    updateFriendBatteryStatus();
});

socket.on('newChatMessage', (data) => {
    if (currentUser?.receiverId === currentUser.userId) { // خطأ، يجب أن يكون data.receiverId
        if (data.receiverId === currentUser.userId) {
            if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message);
            if (currentUser.settings.sound) playNotificationSound();
            if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) {
                addChatMessage(data.senderName, data.message, 'received', data.timestamp);
            }
        }
    }
});

socket.on('removeUserMarker', (data) => {
    if (friendMarkers[data.userId]) friendMarkers[data.userId].remove();
    delete friendMarkers[data.userId];
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if (data.success) socket.emit('requestPOIs');
});

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(createPOIMarker);
});

socket.on('historicalPathData', (data) => {
    if (data.success && data.path?.length) {
        drawHistoricalPath(data.userId, data.path.map(loc => loc.location.coordinates));
        alert(`تم عرض المسار التاريخي لـ ${data.userId}.`);
        togglePanel(null);
    } else {
        alert(data.message || `لا يوجد مسار تاريخي.`);
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (data.success && data.history?.length) {
        chatMessagesDiv.innerHTML = data.history.map(msg => {
            const type = msg.senderId === currentUser.userId ? 'sent' : 'received';
            const name = type === 'sent' ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div class="message ${type}"><span class="message-meta">${name} - ${time}</span><br>${msg.message}</div>`;
        }).join('');
    } else {
        chatMessagesDiv.innerHTML = '<p>لا توجد رسائل سابقة.</p>';
    }
});

// ====== ربط الأحداث عند تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', () => {
    // أزرار التنقل الرئيسية
    document.getElementById('showGeneralMapBtn').onclick = () => { togglePanel(null); showGeneralMap(); };
    document.getElementById('showFriendsMapBtn').onclick = () => { if(currentUser) { togglePanel(null); showFriendsMap(); } };
    document.getElementById('showProfileBtn').onclick = () => { if(currentUser) togglePanel('profilePanel'); };
    document.getElementById('showConnectBtn').onclick = () => { if(currentUser) togglePanel('connectPanel'); };
    document.getElementById('showMoazebBtn').onclick = () => togglePanel('moazebPanel');
    document.getElementById('showFeaturesBtn').onclick = () => { if(currentUser) { togglePanel('featuresPanel'); fetchAndDisplayPrayerTimes(); updateFriendBatteryStatus(); }};
    document.getElementById('showSettingsBtn').onclick = () => { if(currentUser) togglePanel('settingsPanel'); };

    // زر SOS
    document.getElementById('sosButton').onclick = () => {
        if (!currentUser?.settings?.emergencyWhatsapp) return alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات.");
        if (confirm("هل أنت متأكد من إرسال إشارة استغاثة (SOS)؟")) {
            playSOSSound();
            const { coordinates } = currentUser.location;
            const mapLink = coordinates ? `https://www.google.com/maps?q=${coordinates[1]},${coordinates[0]}` : "موقعي غير متاح";
            const message = `مساعدة عاجلة! أنا ${currentUser.name} بحاجة للمساعدة.\nموقعي: ${mapLink}`;
            window.open(`https://wa.me/${currentUser.settings.emergencyWhatsapp}?text=${encodeURIComponent(message)}`, '_blank');
        }
    };

    // قسم المعزب
    document.getElementById('addMoazebBtn').onclick = () => {
        if (!currentUser?.location?.coordinates) return alert("يرجى تفعيل GPS أولاً.");
        const data = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            location: currentUser.location.coordinates
        };
        if (Object.values(data).some(v => !v)) return alert('الرجاء ملء جميع الحقول.');
        socket.emit('addMoazeb', data);
    };
    document.getElementById('searchMoazebBtn').onclick = () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim(),
        };
        if (Object.values(query).every(v => !v)) return alert('أدخل معيار بحث واحد على الأقل.');
        socket.emit('searchMoazeb', query);
    };

    // قسم الميزات
    const poiCategorySelect = document.getElementById('poiCategorySelect');
    const categories = [
        { value: 'Rest Area', text: 'استراحة', icon: '<i class="fas fa-bed"></i>' },
        { value: 'Medical Post', text: 'نقطة طبية', icon: '<i class="fas fa-medkit"></i>' },
        { value: 'Food Station', text: 'طعام', icon: '<i class="fas fa-utensils"></i>' },
        { value: 'Water', text: 'ماء', icon: '<i class="fas fa-faucet"></i>' },
        { value: 'Mosque', text: 'مسجد', icon: '<i class="fas fa-mosque"></i>' },
        { value: 'Parking', text: 'موقف', icon: '<i class="fas fa-parking"></i>' },
        { value: 'Info', text: 'معلومات', icon: '<i class="fas fa-info-circle"></i>' },
        { value: 'Other', text: 'أخرى', icon: '<i class="fas fa-map-marker-alt"></i>' }
    ];
    poiCategorySelect.innerHTML = categories.map(c => `<option value="${c.value}" data-icon='${c.icon}'>${c.text}</option>`).join('');

    document.getElementById('addPoiBtn').onclick = () => {
        if (!currentUser?.location?.coordinates) return alert("يرجى تفعيل GPS أولاً.");
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const selectedOption = poiCategorySelect.options[poiCategorySelect.selectedIndex];
            socket.emit('addCommunityPOI', {
                name: poiName,
                description: prompt("أدخل وصفاً (اختياري):"),
                category: selectedOption.value,
                location: currentUser.location.coordinates,
                icon: selectedOption.dataset.icon
            });
        }
    };
    document.getElementById('setMeetingPointBtn').onclick = () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (!name) return alert("أدخل اسم لنقطة التجمع.");
        if (!currentUser?.location?.coordinates) return alert("فعل GPS أولاً.");
        socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
    };
    document.getElementById('endMeetingPointBtn').onclick = () => {
        if (confirm('هل تريد إنهاء نقطة التجمع؟')) socket.emit('clearMeetingPoint');
    };
    document.getElementById('refreshPrayerTimesBtn').onclick = fetchAndDisplayPrayerTimes;

    // الدردشة
    document.getElementById('bottomChatSendBtn').onclick = sendMessageFromBottomBar;
    document.getElementById('bottomChatInput').onkeypress = (e) => { if (e.key === 'Enter') sendMessageFromBottomBar(); };
    document.getElementById('toggleChatHistoryBtn').onclick = () => { if (currentUser) togglePanel('chatPanel'); setupChatPanel(); };

    // الإعدادات
    ['shareLocationToggle', 'soundToggle', 'hideBubblesToggle', 'stealthModeToggle'].forEach(id => {
        document.getElementById(id).onchange = (e) => socket.emit('updateSettings', { [e.target.id.replace('Toggle', '')]: e.target.checked });
    });
    document.getElementById('updateEmergencyWhatsappBtn').onclick = () => {
        const number = document.getElementById('emergencyWhatsappInput').value.trim();
        if(number) socket.emit('updateSettings', { emergencyWhatsapp: number });
    };
});

map.on('load', showGeneralMap);
