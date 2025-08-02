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
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};
let meetingPointMarker = null; // لتخزين مركر نقطة التجمع

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

// هذه الوظيفة تربط معالجات أحداث الإغلاق
document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
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

    const popupContent = `
        <h3>${friend.name}</h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        ${distanceHtml}
        <p><i class="fas fa-clock"></i> آخر ظهور: ${lastSeenTime}</p>
        <div style="display: flex; justify-content: space-around; margin-top: 10px;">
            <button onclick="unfriendFromPopup('${friend.userId}', '${friend.name}')" class="unfriend-btn"><i class="fas fa-user-minus"></i> إلغاء الارتباط</button>
            <button onclick="chatFromPopup('${friend.userId}')" class="chat-friend-btn"><i class="fas fa-comments"></i> دردشة</button>
        </div>
    `;

    new mapboxgl.Popup({ offset: 25 })
        .setLngLat(friend.location.coordinates)
        .setHTML(popupContent)
        .addTo(map);
}
// دوال مساعدة لمنع المشاكل مع Popups
function unfriendFromPopup(friendId, friendName) {
    if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friendName}؟`)) {
        socket.emit('unfriendUser', { friendId: friendId });
    }
}
function chatFromPopup(friendId) {
    currentChatFriendId = friendId;
    setupBottomChatBar();
    document.getElementById('bottomChatBar').classList.add('active');
    // إغلاق جميع popups
    document.querySelectorAll('.mapboxgl-popup').forEach(p => p.remove());
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    poiMarkers[poi._id] = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || ''}</p>
            <p><strong>الفئة:</strong> ${poi.category}</p>
        `))
        .addTo(map);
    return poiMarkers[poi._id];
}

function showGeneralMap() {
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);
    clearHistoricalPath();
    socket.emit('requestPOIs');
    map.flyTo({ center: [43.6875, 33.3152], zoom: 6 });
}

function showFriendsMap() {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    clearHistoricalPath();

    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        createCustomMarker(currentUser);
    }

    linkedFriends.forEach(friend => {
        if (friend?.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });
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

function startLocationTracking() {
    if (!navigator.geolocation) return alert("متصفحك لا يدعم تحديد المواقع.");
    if (!currentUser) return;
    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', {
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
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {});
}

function playSOSSound() {
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3').play().catch(e => {});
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId || !messageText) return;

    if (document.getElementById('chatPanel').classList.contains('active')) {
         addChatMessage(currentUser.name, messageText, 'sent', new Date());
    }
    socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
    if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, messageText);
    document.getElementById('bottomChatInput').value = '';
}

function addChatMessage(senderName, messageText, type = '', timestamp = new Date()) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    msgDiv.innerHTML = `<span class="message-meta">${senderName} - ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><br>${messageText}`;
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
    list.innerHTML = linkedFriends.length > 0 ? 
        linkedFriends.map(friend => `<li>${friend.name}: ${friend.batteryStatus || 'N/A'}</li>`).join('') :
        '<li>لا يوجد أصدقاء مرتبطون.</li>';
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
        if (!currentChatFriendId || !linkedFriends.some(f => f.userId === currentChatFriendId)) {
            currentChatFriendId = linkedFriends[0].userId;
        }
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
    container.innerHTML = !results || results.length === 0 ?
        '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>' :
        results.map(moazeb => `
            <div class="moazeb-card">
                <h4>${moazeb.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
                <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
                <p><i class="fas fa-globe-asia"></i> ${moazeb.governorate} - ${moazeb.district}</p>
            </div>
        `).join('');
}

// ====== التعامل مع أحداث WebSocket من الخادم ======
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
    localStorage.setItem('appEmergencyWhatsapp', user.settings.emergencyWhatsapp || '');

    // Update UI
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userPhoto').src = user.photo;
    document.getElementById('userLinkCode').textContent = user.linkCode;
    ['editUserNameInput', 'initialInfoNameInput'].forEach(id => document.getElementById(id).value = user.name);
    ['editGenderSelect', 'initialInfoGenderSelect'].forEach(id => document.getElementById(id).value = user.gender || 'other');
    ['editPhoneInput', 'initialInfoPhoneInput'].forEach(id => document.getElementById(id).value = user.phone || '');
    ['editEmailInput', 'initialInfoEmailInput'].forEach(id => document.getElementById(id).value = user.email || '');
    document.getElementById('emergencyWhatsappInput').value = user.settings.emergencyWhatsapp || '';
    Object.keys(user.settings).forEach(key => {
        const toggle = document.getElementById(`${key}Toggle`);
        if (toggle) toggle.checked = user.settings[key];
    });

    startLocationTracking();
    if (user.linkedFriends?.length > 0) socket.emit('requestFriendsData', { friendIds: user.linkedFriends });

    if (!user.name || (user.gender === 'other') || !user.phone || !user.email) {
        document.getElementById('initialInfoPanel').classList.add('active');
    }

    if (user.meetingPoint?.name) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').value = user.meetingPoint.name;
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate = (currentUser && data.userId === currentUser.userId) ? currentUser : linkedFriends.find(f => f.userId === data.userId);
    if (userToUpdate) {
        Object.assign(userToUpdate, data);
        userToUpdate.location = { type: 'Point', coordinates: data.location };
        if (!data.settings.shareLocation || data.settings.stealthMode) {
            if (friendMarkers[data.userId]) {
                friendMarkers[data.userId].remove();
                delete friendMarkers[data.userId];
            }
        } else {
            createCustomMarker(userToUpdate);
        }
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    showFriendsMap();
    setupBottomChatBar();
    updateFriendBatteryStatus();
});

socket.on('prayerTimesData', (data) => {
    const el = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        el.innerHTML = `
            <p><strong>الفجر:</strong> ${data.timings.Fajr}</p>
            <p><strong>الظهر:</strong> ${data.timings.Dhuhr}</p>
            <p><strong>العصر:</strong> ${data.timings.Asr}</p>
            <p><strong>المغرب:</strong> ${data.timings.Maghrib}</p>
            <p><strong>العشاء:</strong> ${data.timings.Isha}</p>
        `;
    } else {
        el.innerHTML = `<p style="color:red;">${data.message}</p>`;
    }
});

socket.on('newMeetingPoint', (data) => {
    drawMeetingPoint(data);
    if (currentUser?.userId === data.creatorId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        alert(`تم تحديد نقطة التجمع "${data.point.name}" بنجاح.`);
    }
});

socket.on('meetingPointCleared', (data) => {
    clearMeetingPointMarker();
    if (currentUser?.userId === data.creatorId) {
        document.getElementById('endMeetingPointBtn').style.display = 'none';
        document.getElementById('setMeetingPointBtn').style.display = 'block';
        document.getElementById('meetingPointInput').value = '';
        alert('تم إنهاء نقطة التجمع.');
    }
});

socket.on('moazebStatus', (data) => {
    alert(data.message);
    if (data.success) {
        ['addMoazebName', 'addMoazebAddress', 'addMoazebPhone', 'addMoazebGov', 'addMoazebDist'].forEach(id => document.getElementById(id).value = '');
    }
});

socket.on('moazebSearchResults', (data) => data.success ? displayMoazebResults(data.results) : alert('خطأ في البحث.'));

socket.on('linkStatus', (data) => {
    alert(data.message);
    if (data.success) document.getElementById('showFriendsMapBtn').click();
});

socket.on('unfriendStatus', (data) => {
    alert(data.message);
    if (data.success) document.getElementById('showFriendsMapBtn').click();
});

socket.on('newChatMessage', (data) => {
    if (currentUser?.userId === data.receiverId) {
        playNotificationSound();
        if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message);
        if (currentChatFriendId === data.senderId && document.getElementById('chatPanel').classList.contains('active')) {
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

socket.on('updatePOIsList', (poisData) => {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    poisData.forEach(createPOIMarker);
});

socket.on('historicalPathData', (data) => {
    if (data.success && data.path?.length > 0) {
        drawHistoricalPath(data.userId, data.path.map(loc => loc.location.coordinates));
        alert(`تم عرض المسار التاريخي لـ ${data.userId}.`);
        togglePanel(null);
    } else {
        alert(data.message || 'لا توجد بيانات مسار تاريخي.');
    }
});

socket.on('chatHistoryData', (data) => {
    const div = document.getElementById('chatMessages');
    div.innerHTML = '';
    if (data.success && data.history?.length > 0) {
        data.history.forEach(msg => {
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const name = type === 'sent' ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(name, msg.message, type, msg.timestamp);
        });
    } else {
        div.innerHTML = '<p style="text-align: center; color: #777;">لا توجد رسائل سابقة.</p>';
    }
});

// ====== معالجات أحداث الواجهة ======
document.addEventListener('DOMContentLoaded', () => {
    // Buttons in header
    document.getElementById('showGeneralMapBtn').onclick = () => { togglePanel(null); showGeneralMap(); };
    document.getElementById('showFriendsMapBtn').onclick = () => { togglePanel(null); showFriendsMap(); };
    document.getElementById('showProfileBtn').onclick = () => togglePanel('profilePanel');
    document.getElementById('showConnectBtn').onclick = () => togglePanel('connectPanel');
    document.getElementById('showMoazebBtn').onclick = () => togglePanel('moazebPanel');
    document.getElementById('showFeaturesBtn').onclick = () => { togglePanel('featuresPanel'); updateFriendBatteryStatus(); fetchAndDisplayPrayerTimes(); };
    document.getElementById('showSettingsBtn').onclick = () => togglePanel('settingsPanel');
    
    // Initial Info Panel
    document.getElementById('initialInfoConfirmBtn').onclick = () => {
        const data = {
            name: document.getElementById('initialInfoNameInput').value.trim(),
            gender: document.getElementById('initialInfoGenderSelect').value,
            phone: document.getElementById('initialInfoPhoneInput').value.trim(),
            email: document.getElementById('initialInfoEmailInput').value.trim()
        };
        if (Object.values(data).every(val => val && val !== 'other')) {
            socket.emit('updateSettings', data);
            document.getElementById('initialInfoPanel').classList.remove('active');
        } else {
            alert('الرجاء ملء جميع الحقول المطلوبة.');
        }
    };
    
    // Chat bar
    document.getElementById('bottomChatSendBtn').onclick = sendMessageFromBottomBar;
    document.getElementById('bottomChatInput').onkeypress = (e) => e.key === 'Enter' && sendMessageFromBottomBar();
    document.getElementById('toggleChatHistoryBtn').onclick = () => { if(linkedFriends.length > 0) { togglePanel('chatPanel'); setupChatPanel(); } else { alert('لا يوجد أصدقاء للدردشة.')}};
    
    // Features Panel
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
        if (!currentUser?.location?.coordinates) return alert("يرجى تفعيل GPS وتحديد موقعك أولاً.");
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const selected = poiCategorySelect.options[poiCategorySelect.selectedIndex];
            socket.emit('addCommunityPOI', {
                name: poiName,
                description: prompt("أدخل وصفاً (اختياري):"),
                category: selected.value,
                location: currentUser.location.coordinates,
                icon: selected.dataset.icon
            });
        }
    };

    document.getElementById('setMeetingPointBtn').onclick = () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (name && currentUser?.location?.coordinates) {
            socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
        } else {
            alert("أدخل اسمًا لنقطة التجمع وحدد موقعك.");
        }
    };
    document.getElementById('endMeetingPointBtn').onclick = () => {
        if (confirm('هل أنت متأكد من إنهاء نقطة التجمع؟')) socket.emit('clearMeetingPoint');
    };
    
    // Moazeb Panel
    document.getElementById('addMoazebBtn').onclick = () => {
        const data = {
            name: document.getElementById('addMoazebName').value.trim(),
            address: document.getElementById('addMoazebAddress').value.trim(),
            phone: document.getElementById('addMoazebPhone').value.trim(),
            governorate: document.getElementById('addMoazebGov').value.trim(),
            district: document.getElementById('addMoazebDist').value.trim(),
            location: currentUser?.location?.coordinates
        };
        if (Object.values(data).every(val => val)) {
            socket.emit('addMoazeb', data);
        } else {
            alert('يرجى ملء جميع حقول المضيف وتحديد موقعك.');
        }
    };
    document.getElementById('searchMoazebBtn').onclick = () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim()
        };
        if (Object.values(query).some(val => val)) {
            socket.emit('searchMoazeb', query);
        } else {
            alert('أدخل معيارًا واحدًا للبحث على الأقل.');
        }
    };

    // SOS Button
    document.getElementById('sosButton').onclick = () => {
        const emergencyNum = currentUser?.settings?.emergencyWhatsapp;
        if (!emergencyNum) return alert("الرجاء إضافة رقم طوارئ في الإعدادات.");
        if (confirm("هل أنت متأكد من إرسال إشارة استغاثة (SOS)؟")) {
            playSOSSound();
            const lat = currentUser.location.coordinates[1];
            const lng = currentUser.location.coordinates[0];
            const message = `مساعدة عاجلة! أنا بحاجة للمساعدة.\nموقعي الحالي: https://www.google.com/maps?q=${lat},${lng}\n\nمن تطبيق طريق الجنة - ${currentUser.name}`;
            window.open(`https://wa.me/${emergencyNum}?text=${encodeURIComponent(message)}`, '_blank');
        }
    };

    // Settings Panel Toggles
    ['shareLocationToggle', 'soundToggle', 'hideBubblesToggle', 'stealthModeToggle'].forEach(id => {
        document.getElementById(id).onchange = (e) => {
            socket.emit('updateSettings', { [e.target.id.replace('Toggle', '')]: e.target.checked });
        };
    });
    document.getElementById('updateEmergencyWhatsappBtn').onclick = () => {
        const num = document.getElementById('emergencyWhatsappInput').value.trim();
        if (num) socket.emit('updateSettings', { emergencyWhatsapp: num });
    };

    // Connect Panel
    document.getElementById('connectFriendBtn').onclick = () => {
        const code = document.getElementById('friendCodeInput').value.trim();
        if(code) socket.emit('requestLink', { friendCode: code });
    };

    // Map Controls
    document.getElementById('mapPitch').oninput = (e) => map.setPitch(e.target.value);
    document.getElementById('mapBearing').oninput = (e) => map.setBearing(e.target.value);
});

map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
});
