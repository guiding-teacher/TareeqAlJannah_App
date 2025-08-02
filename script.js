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
const socket = io('https://tareeqaljannah-app.onrender.com');


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
    if (!poi || !poi.location || !poi.location.coordinates) {
        return null;
    }
    if (poiMarkers[poi._id]) {
        poiMarkers[poi._id].remove();
    }
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
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    clearHistoricalPath();
    clearMeetingPointMarker();
    holySites.forEach(site => {
        // ... (كود عرض المواقع المقدسة)
    });
    socket.emit('requestPOIs');
    map.flyTo({
        center: [43.6875, 33.3152],
        zoom: 6,
    });
}

function showFriendsMap() {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    clearHistoricalPath();
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
    }
    linkedFriends.forEach(friend => {
        if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });
    // ... (كود رسم خطوط الربط)
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
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates }
        }
    });
    map.addLayer({
        'id': layerId, 'type': 'line', 'source': layerId,
        'paint': { 'line-color': '#FF00FF', 'line-width': 6 }
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
    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            if (currentUser) {
                socket.emit('updateLocation', {
                    location: [longitude, latitude],
                    battery: await getBatteryStatus()
                });
            }
        },
        (error) => console.error("خطأ في تحديد الموقع:", error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

async function getBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            return (battery.level * 100).toFixed(0) + '%';
        } catch (e) {
            return 'N/A';
        }
    }
    return 'N/A';
}


// ====== وظائف الدردشة والصوت ======
function playNotificationSound() {
    if (currentUser && currentUser.settings.sound) {
        new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {});
    }
}

function playSOSSound() {
    if (currentUser && currentUser.settings.sound) {
        new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3').play().catch(e => {});
    }
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId) {
        alert("الرجاء اختيار صديق للدردشة.");
        return;
    }
    if (messageText) {
        if (document.getElementById('chatPanel').classList.contains('active')) {
             addChatMessage(currentUser.name, messageText, 'sent', new Date());
        }
        socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
        playNotificationSound();
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(currentUser.userId, messageText);
        }
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
        if (activeMessageTimers[userId]) {
            clearTimeout(activeMessageTimers[userId]);
        }
        bubble.textContent = messageText;
        bubble.classList.add('show');
        activeMessageTimers[userId] = setTimeout(() => {
            bubble.classList.remove('show');
        }, 15000); // مدة 15 ثانية
    }
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
    document.getElementById('chatMessages').innerHTML = '<p>جاري تحميل الرسائل...</p>';
    socket.emit('requestChatHistory', { friendId: currentChatFriendId });
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const bottomChatFriendSelect = document.getElementById('bottomChatFriendSelect');
    if (linkedFriends.length > 0) {
        const currentSelection = bottomChatFriendSelect.value;
        bottomChatFriendSelect.innerHTML = '';
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            bottomChatFriendSelect.appendChild(option);
        });
        bottomChatFriendSelect.value = linkedFriends.some(f => f.userId === currentSelection) ? currentSelection : linkedFriends[0]?.userId || '';
        currentChatFriendId = bottomChatFriendSelect.value;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
        currentChatFriendId = null;
    }
    bottomChatFriendSelect.onchange = (e) => currentChatFriendId = e.target.value;
}


// ====== وظائف الميزات الإضافية ======
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

function fetchAndDisplayPrayerTimes() {
    document.getElementById('prayerTimesDisplay').innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';
    socket.emit('requestPrayerTimes');
}

function drawMeetingPoint(data) {
    if (meetingPointMarker) meetingPointMarker.remove();
    if (!data || !data.point || !data.point.location || !data.point.location.coordinates.length) return;
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
    container.innerHTML = '';
    if (!results || results.length === 0) {
        container.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
        return;
    }
    results.forEach(moazeb => {
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
}


// ====== التعامل مع أحداث WebSocket من الخادم ======
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const storedData = {
        userId,
        name: localStorage.getItem('appUserName'),
        photo: localStorage.getItem('appUserPhoto'),
        gender: localStorage.getItem('appUserGender'),
        phone: localStorage.getItem('appUserPhone'),
        email: localStorage.getItem('appUserEmail'),
        emergencyWhatsapp: localStorage.getItem('appEmergencyWhatsapp')
    };
    socket.emit('registerUser', storedData);
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    localStorage.setItem('appUserId', user.userId);
    localStorage.setItem('appUserName', user.name);
    localStorage.setItem('appUserPhoto', user.photo);
    localStorage.setItem('appUserGender', user.gender || '');
    localStorage.setItem('appUserPhone', user.phone || '');
    localStorage.setItem('appUserEmail', user.email || '');
    localStorage.setItem('appEmergencyWhatsapp', user.settings.emergencyWhatsapp || '');

    // تحديث الواجهة
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userPhoto').src = user.photo;
    document.getElementById('userLinkCode').textContent = user.linkCode;
    document.getElementById('editUserNameInput').value = user.name;
    document.getElementById('editGenderSelect').value = user.gender || 'other';
    document.getElementById('editPhoneInput').value = user.phone || '';
    document.getElementById('editEmailInput').value = user.email || '';
    document.getElementById('shareLocationToggle').checked = user.settings.shareLocation;
    document.getElementById('soundToggle').checked = user.settings.sound;
    document.getElementById('hideBubblesToggle').checked = user.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = user.settings.stealthMode;
    document.getElementById('emergencyWhatsappInput').value = user.settings.emergencyWhatsapp || '';

    // تحديث واجهة نقطة التجمع
    if (user.meetingPoint && user.meetingPoint.name) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').value = user.meetingPoint.name;
    } else {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
    }

    startLocationTracking();
    if (user.linkedFriends && user.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: user.linkedFriends });
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (currentUser && data.userId === currentUser.userId) {
        currentUser.location = { type: 'Point', coordinates: data.location };
        currentUser.batteryStatus = data.battery;
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
        if (userToUpdate) {
            userToUpdate.location = { type: 'Point', coordinates: data.location };
            userToUpdate.batteryStatus = data.battery;
            userToUpdate.settings = data.settings;
        }
    }
    if (userToUpdate && userToUpdate.settings.shareLocation && !userToUpdate.settings.stealthMode) {
        createCustomMarker(userToUpdate);
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    showFriendsMap();
    setupBottomChatBar();
    updateFriendBatteryStatus();
    // ... تحديث قائمة الأصدقاء في لوحة الربط
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
});

socket.on('newChatMessage', (data) => {
    if (currentUser && data.receiverId === currentUser.userId) {
        playNotificationSound();
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(data.senderId, data.message);
        }
        if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(data.senderName, data.message, 'received', data.timestamp);
        }
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history.length > 0) {
        data.history.forEach(msg => {
            const isSent = msg.senderId === currentUser.userId;
            const senderName = isSent ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(senderName, msg.message, isSent ? 'sent' : 'received', msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p>لا توجد رسائل سابقة.</p>';
    }
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if(data.success) socket.emit('requestPOIs');
});

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(poi => createPOIMarker(poi));
});

socket.on('historicalPathData', (data) => {
    if (data.success && data.path.length > 0) {
        const coordinates = data.path.map(loc => loc.location.coordinates);
        drawHistoricalPath(data.userId, coordinates);
        alert(`تم عرض المسار التاريخي.`);
        togglePanel(null);
    } else {
        alert(data.message || 'لا يوجد مسار تاريخي لعرضه.');
    }
});

socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        displayElement.innerHTML = `
            <p><strong>الفجر:</strong> ${data.timings.Fajr}</p>
            <p><strong>الظهر:</strong> ${data.timings.Dhuhr}</p>
            <p><strong>العصر:</strong> ${data.timings.Asr}</p>
            <p><strong>المغرب:</strong> ${data.timings.Maghrib}</p>
            <p><strong>العشاء:</strong> ${data.timings.Isha}</p>
        `;
    } else {
        displayElement.innerHTML = `<p>${data.message}</p>`;
    }
});

socket.on('newMeetingPoint', (data) => {
    drawMeetingPoint(data);
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        alert(`تم تحديد نقطة التجمع "${data.point.name}" بنجاح.`);
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
    if (data.success) {
        document.getElementById('addMoazebName').value = '';
        document.getElementById('addMoazebAddress').value = '';
        document.getElementById('addMoazebPhone').value = '';
        document.getElementById('addMoazebGov').value = '';
        document.getElementById('addMoazebDist').value = '';
    }
});

socket.on('moazebSearchResults', (data) => {
    if (data.success) {
        displayMoazebResults(data.results);
    } else {
        alert('حدث خطأ أثناء البحث.');
    }
});


// ====== ربط الأحداث عند تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', () => {
    // الأزرار الرئيسية
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { togglePanel(null); document.getElementById('showGeneralMapBtn').classList.add('active'); showGeneralMap(); });
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { togglePanel(null); document.getElementById('showFriendsMapBtn').classList.add('active'); showFriendsMap(); });
    document.getElementById('showProfileBtn').addEventListener('click', () => togglePanel('profilePanel'));
    document.getElementById('showConnectBtn').addEventListener('click', () => togglePanel('connectPanel'));
    document.getElementById('showFeaturesBtn').addEventListener('click', () => { togglePanel('featuresPanel'); fetchAndDisplayPrayerTimes(); updateFriendBatteryStatus(); });
    document.getElementById('showSettingsBtn').addEventListener('click', () => togglePanel('settingsPanel'));
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));

    // لوحة الربط
    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if (friendCode) socket.emit('requestLink', { friendCode });
    });

    // الدردشة
    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => e.key === 'Enter' && sendMessageFromBottomBar());
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => {
        if (linkedFriends.length > 0) {
            togglePanel('chatPanel');
            setupChatPanel();
        } else {
            alert("الرجاء ربط صديق أولاً.");
        }
    });

    // لوحة الميزات
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
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.value;
        option.dataset.icon = cat.icon;
        option.innerHTML = cat.text;
        poiCategorySelect.appendChild(option);
    });

    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates[0]) {
            alert("يرجى تفعيل GPS أولاً.");
            return;
        }
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
    });

    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (name && currentUser && currentUser.location && currentUser.location.coordinates[0]) {
            socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
        } else {
            alert("أدخل اسمًا لنقطة التجمع أولاً.");
        }
    });
    document.getElementById('endMeetingPointBtn').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إنهاء نقطة التجمع؟')) {
            socket.emit('clearMeetingPoint');
        }
    });

    // لوحة المعزب
    document.getElementById('addMoazebBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates[0]) {
             alert("يرجى تفعيل GPS أولاً.");
             return;
        }
        const data = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            location: currentUser.location.coordinates
        };
        if (data.name && data.address && data.phone && data.governorate && data.district) {
            socket.emit('addMoazeb', data);
        } else {
            alert('الرجاء ملء جميع حقول المضيف.');
        }
    });
    document.getElementById('searchMoazebBtn').addEventListener('click', () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim()
        };
        if (query.phone || query.governorate || query.district) {
            socket.emit('searchMoazeb', query);
        } else {
            alert('أدخل معيارًا واحدًا للبحث على الأقل.');
        }
    });

    // الإعدادات
    document.getElementById('shareLocationToggle').addEventListener('change', (e) => socket.emit('updateSettings', { shareLocation: e.target.checked }));
    document.getElementById('soundToggle').addEventListener('change', (e) => socket.emit('updateSettings', { sound: e.target.checked }));
    document.getElementById('hideBubblesToggle').addEventListener('change', (e) => socket.emit('updateSettings', { hideBubbles: e.target.checked }));
    document.getElementById('stealthModeToggle').addEventListener('change', (e) => socket.emit('updateSettings', { stealthMode: e.target.checked }));
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => {
        const number = document.getElementById('emergencyWhatsappInput').value.trim();
        if(number) socket.emit('updateSettings', { emergencyWhatsapp: number });
    });
    
    // زر الطوارئ SOS
    document.getElementById('sosButton').addEventListener('click', () => {
        if (!currentUser || !currentUser.settings.emergencyWhatsapp) {
            alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
            return;
        }
        if (confirm("هل أنت متأكد من إرسال إشارة استغاثة (SOS)؟")) {
            playSOSSound();
            let message = "مساعدة عاجلة! أنا بحاجة للمساعدة.\n";
            if (currentUser.location && currentUser.location.coordinates[0]) {
                const [lng, lat] = currentUser.location.coordinates;
                message += `موقعي الحالي: https://www.google.com/maps?q=${lat},${lng}\n`;
            } else {
                message += "موقعي غير متاح حالياً.\n";
            }
            message += `من تطبيق طريق الجنة - ${currentUser.name}`;
            const whatsappUrl = `https://wa.me/${currentUser.settings.emergencyWhatsapp}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');
        }
    });
});
