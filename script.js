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
let meetingPointMarker = null;
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

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.querySelectorAll('.main-header nav button').forEach(btn => btn.classList.remove('active'));
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

    const userPhotoSrc = user.photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER';

    el.innerHTML = `
        <img class="user-marker-photo" src="${userPhotoSrc}" alt="${user.name}">
        <div class="user-marker-name">${user.name}</div>
        <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(user.location.coordinates)
        .addTo(map);

    if (currentUser && user.userId !== currentUser.userId) {
        marker.getElement().addEventListener('click', () => showFriendDetailsPopup(user));
    }

    friendMarkers[user.userId] = marker;
    return marker;
}

function showFriendDetailsPopup(friend) {
    const existingPopup = friendMarkers[friend.userId]?._popup;
    if (existingPopup) existingPopup.remove();
    
    const currentUserHasValidLocation = currentUser && currentUser.location && currentUser.location.coordinates && (currentUser.location.coordinates[0] !== 0 || currentUser.location.coordinates[1] !== 0);
    const friendHasValidLocation = friend && friend.location && friend.location.coordinates && (friend.location.coordinates[0] !== 0 || friend.location.coordinates[1] !== 0);

    let distanceHtml = '<p><i class="fas fa-route"></i> المسافة عنك: موقع غير محدد</p>';
    if (currentUserHasValidLocation && friendHasValidLocation) {
        const distance = calculateDistance(currentUser.location.coordinates[1], currentUser.location.coordinates[0], friend.location.coordinates[1], friend.location.coordinates[0]).toFixed(2);
        distanceHtml = `<p><i class="fas fa-route"></i> المسافة عنك: ${distance} كم</p>`;
    }
    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'غير معروف';

    const popupContent = `
        <h3>${friend.name}</h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        ${distanceHtml}
        <p><i class="fas fa-clock"></i> آخر ظهور: ${lastSeenTime}</p>
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
        document.getElementById(`unfriendBtn-${friend.userId}`).onclick = () => {
            if (confirm(`هل أنت متأكد من إلغاء الارتباط بـ ${friend.name}؟`)) {
                socket.emit('unfriendUser', { friendId: friend.userId });
                popup.remove();
            }
        };
        document.getElementById(`chatFriendBtn-${friend.userId}`).onclick = () => {
            currentChatFriendId = friend.userId;
            setupBottomChatBar();
            document.getElementById('bottomChatBar').classList.add('active');
            popup.remove();
        };
    });
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    poiMarkers[poi._id] = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`<h3>${poi.name}</h3><p>${poi.description || ''}</p>`))
        .addTo(map);
}

function createMeetingPointMarker(data) {
    if (meetingPointMarker) meetingPointMarker.remove();

    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;
    meetingPointMarker = new mapboxgl.Marker(el)
        .setLngLat(data.point.location.coordinates)
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>نقطة التجمع: ${data.point.name}</h3><p>بواسطة: ${data.creatorName}</p>`))
        .addTo(map);

    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        document.getElementById('setMeetingPointBtn').style.display = 'none';
        document.getElementById('meetingPointInput').disabled = true;
        document.getElementById('meetingPointInput').value = data.point.name;
    }
}

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
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);
    
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath();
    socket.emit('requestPOIs');
    map.flyTo({ center: [43.6875, 33.3152], zoom: 6, pitch: 45, bearing: -17.6 });
}

function showFriendsMap() {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath();

    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    // مسح خطوط الاتصال القديمة
    linkedFriends.forEach(friend => {
        const layerId = `line-${currentUser.userId}-${friend.userId}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(layerId)) map.removeSource(layerId);
    });

    // رسم المستخدم الحالي
    if (currentUser && currentUser.location?.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
    }
    
    // رسم الأصدقاء
    linkedFriends.forEach(friend => {
        if (friend.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);

            // **حل المشكلة 2: إعادة إضافة منطق رسم الخطوط**
            // يتم رسم الخط فقط إذا كان المستخدم الحالي وصديقه مرئيين
            if (currentUser && currentUser.location?.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
                 drawConnectionLine(currentUser.location.coordinates, friend.location.coordinates, `line-${currentUser.userId}-${friend.userId}`);
            }
        }
    });
}

function drawConnectionLine(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords || startCoords[0] === 0 || endCoords[0] === 0) return;

    const geojson = {
        'type': 'Feature', 'properties': {},
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

    map.addSource(layerId, { 'type': 'geojson', 'data': { 'type': 'Feature', 'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates } } });
    map.addLayer({
        'id': layerId, 'type': 'line', 'source': layerId,
        'paint': { 'line-color': '#FF00FF', 'line-width': 6, 'line-opacity': 0.8 }
    });
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
    if (!navigator.geolocation || !currentUser) return;

    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', {
                location: [longitude, latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => { console.error("خطأ في تحديد الموقع:", error.message); },
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
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {});
}

function playSOSSound() {
    if (currentUser?.settings.sound) new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3').play().catch(e => {});
}

function sendMessageFromBottomBar() {
    const messageText = document.getElementById('bottomChatInput').value.trim();
    if (!currentUser || !currentChatFriendId || !messageText) return;

    socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
    if (document.getElementById('chatPanel').classList.contains('active')) {
         addChatMessage(currentUser.name, messageText, 'sent', new Date());
    }
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
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 5000);
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
    chatFriendSelect.innerHTML = linkedFriends.map(f => `<option value="${f.userId}">${f.name}</option>`).join('');
    currentChatFriendId = document.getElementById('bottomChatFriendSelect').value || linkedFriends[0]?.userId;
    if (currentChatFriendId) {
        chatFriendSelect.value = currentChatFriendId;
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        document.getElementById('chatMessages').innerHTML = '<p>لا يوجد أصدقاء للدردشة.</p>';
    }
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const select = document.getElementById('bottomChatFriendSelect');
    select.innerHTML = linkedFriends.map(f => `<option value="${f.userId}">${f.name}</option>`).join('');
    if (linkedFriends.length > 0) {
        currentChatFriendId = linkedFriends[0].userId;
        select.value = currentChatFriendId;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
        currentChatFriendId = null;
    }
}

// ====== التعامل مع أحداث WebSocket من الخادم ======

socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId') || 'user_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('appUserId', userId);
    socket.emit('registerUser', { userId, name: localStorage.getItem('appUserName'), photo: localStorage.getItem('appUserPhoto') });
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    localStorage.setItem('appUserId', currentUser.userId);
    localStorage.setItem('appUserName', currentUser.name);
    // ... تحديث بقية الواجهة
    startLocationTracking();
    if (currentUser.linkedFriends?.length > 0) socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    if (!currentUser.name || currentUser.name.startsWith('مستخدم_')) document.getElementById('initialInfoPanel').classList.add('active');
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (currentUser && data.userId === currentUser.userId) {
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
    }
    
    if (userToUpdate) {
        // **حل المشكلة 1: تحديث الكائن المحلي بشكل صحيح**
        // هذا يضمن أن `currentUser.location.coordinates` محدث دائمًا بأحدث قيمة من الخادم
        userToUpdate.location = { type: 'Point', coordinates: data.location };
        userToUpdate.batteryStatus = data.battery;
        userToUpdate.settings = data.settings;
        userToUpdate.lastSeen = data.lastSeen;

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
    if (data.success) document.getElementById('showFriendsMapBtn').click();
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    showFriendsMap();
    setupBottomChatBar();
    updateFriendBatteryStatus();
});

socket.on('newChatMessage', (data) => {
    if (currentUser?.receiverId === currentUser.userId) {
        if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message);
        playNotificationSound();
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
    if (data.success && data.path?.length > 0) {
        drawHistoricalPath(data.userId, data.path.map(loc => loc.location.coordinates));
        alert(`تم عرض المسار التاريخي.`);
        togglePanel(null);
    } else {
        alert(`فشل جلب المسار أو لا توجد بيانات.`);
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history?.length > 0) {
        data.history.forEach(msg => {
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const name = type === 'sent' ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(name, msg.message, type, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p>لا توجد رسائل سابقة.</p>';
    }
});

socket.on('newMeetingPoint', (data) => {
    // **حل المشكلة 3: تحديث الكائن المحلي عند استقبال نقطة تجمع**
    // هذا مهم للمستخدم المُنشئ ليتذكر حالته
    if (currentUser && data.creatorId === currentUser.userId) {
        currentUser.meetingPoint = data.point;
    }
    createMeetingPointMarker(data);
    if (data.creatorId !== currentUser.userId) {
        alert(`${data.creatorName} قام بإنشاء نقطة تجمع جديدة.`);
    }
});

socket.on('meetingPointCleared', (data) => {
    if (currentUser) currentUser.meetingPoint = undefined;
    clearMeetingPointMarker();
    alert(`تم إنهاء نقطة التجمع.`);
});

socket.on('moazebStatus', (data) => alert(data.message));
socket.on('moazebSearchResults', (data) => {
    const container = document.getElementById('moazebResultsContainer');
    container.innerHTML = data.success && data.results.length > 0
        ? data.results.map(moazeb => `<div class="moazeb-card"><h4>${moazeb.name}</h4><p>${moazeb.address}</p><p>${moazeb.phone}</p></div>`).join('')
        : '<p>لم يتم العثور على نتائج.</p>';
});

socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        displayElement.innerHTML = Object.entries(data.timings).map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`).join('');
    } else {
        displayElement.innerHTML = `<p>${data.message || 'فشل التحميل.'}</p>`;
    }
});

map.on('load', () => {
    document.getElementById('showGeneralMapBtn').classList.add('active');
});

document.addEventListener('DOMContentLoaded', () => {
    // الأزرار الرئيسية
    document.getElementById('showGeneralMapBtn').onclick = () => { togglePanel(null); showGeneralMap(); };
    document.getElementById('showFriendsMapBtn').onclick = () => { togglePanel(null); showFriendsMap(); };
    document.getElementById('showProfileBtn').onclick = () => togglePanel('profilePanel');
    document.getElementById('showConnectBtn').onclick = () => togglePanel('connectPanel');
    document.getElementById('showFeaturesBtn').onclick = () => {
        togglePanel('featuresPanel');
        updateFriendBatteryStatus();
        fetchAndDisplayPrayerTimes();
    };
    document.getElementById('showSettingsBtn').onclick = () => togglePanel('settingsPanel');
    document.getElementById('showMoazebBtn').onclick = () => togglePanel('moazebPanel');

    // الإجراءات
    document.getElementById('initialInfoConfirmBtn').onclick = () => {
        const data = { name: document.getElementById('initialInfoNameInput').value.trim(), gender: document.getElementById('initialInfoGenderSelect').value, phone: document.getElementById('initialInfoPhoneInput').value.trim(), email: document.getElementById('initialInfoEmailInput').value.trim() };
        if (data.name && data.gender !== 'other' && data.phone && data.email) {
            socket.emit('updateSettings', data);
            document.getElementById('initialInfoPanel').classList.remove('active');
        } else alert('الرجاء ملء جميع الحقول.');
    };

    document.getElementById('connectFriendBtn').onclick = () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if (friendCode) socket.emit('requestLink', { friendCode });
    };

    document.getElementById('bottomChatSendBtn').onclick = sendMessageFromBottomBar;
    document.getElementById('toggleChatHistoryBtn').onclick = () => {
        if (!linkedFriends.length) return alert("اربط حساب صديق أولاً.");
        togglePanel('chatPanel');
        setupChatPanel();
    };

    // الميزات
    document.getElementById('setMeetingPointBtn').onclick = () => {
        const name = document.getElementById('meetingPointInput').value.trim();
        if (!name) return alert("أدخل اسمًا لنقطة التجمع.");
        if (!currentUser?.location?.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح. يرجى الانتظار أو تفعيل GPS.");
        }
        socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates });
    };
    document.getElementById('endMeetingPointBtn').onclick = () => {
        if (confirm("هل أنت متأكد من إنهاء نقطة التجمع للجميع؟")) {
            socket.emit('clearMeetingPoint');
        }
    };
    
    document.getElementById('addPoiBtn').onclick = () => {
        if (!currentUser?.location?.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح لإضافة نقطة. يرجى الانتظار أو تفعيل GPS.");
        }
        const name = prompt("أدخل اسم نقطة الاهتمام:");
        if (name) {
            socket.emit('addCommunityPOI', { name, description: prompt("الوصف:"), category: document.getElementById('poiCategorySelect').value, location: currentUser.location.coordinates });
        }
    };

    // المعزب
    document.getElementById('addMoazebBtn').onclick = () => {
        if (!currentUser?.location?.coordinates || currentUser.location.coordinates[0] === 0) {
            return alert("موقعك الحالي غير متاح لإضافة مضيف. يرجى الانتظار أو تفعيل GPS.");
        }
        const data = { name: document.getElementById('addMoazebName').value, address: document.getElementById('addMoazebAddress').value, phone: document.getElementById('addMoazebPhone').value, governorate: document.getElementById('addMoazebGov').value, district: document.getElementById('addMoazebDist').value };
        if (Object.values(data).some(v => !v)) return alert("الرجاء ملء جميع حقول المضيف.");
        data.location = currentUser.location.coordinates;
        socket.emit('addMoazeb', data);
    };

    document.getElementById('searchMoazebBtn').onclick = () => {
        const query = { phone: document.getElementById('searchMoazebPhone').value, governorate: document.getElementById('searchMoazebGov').value, district: document.getElementById('searchMoazebDist').value };
        Object.keys(query).forEach(key => query[key] === '' && delete query[key]);
        if (Object.keys(query).length > 0) socket.emit('searchMoazeb', query);
    };

    // الإعدادات
    document.getElementById('shareLocationToggle').onchange = (e) => socket.emit('updateSettings', { shareLocation: e.target.checked });
    document.getElementById('soundToggle').onchange = (e) => socket.emit('updateSettings', { sound: e.target.checked });
    document.getElementById('hideBubblesToggle').onchange = (e) => socket.emit('updateSettings', { hideBubbles: e.target.checked });
    document.getElementById('stealthModeToggle').onchange = (e) => socket.emit('updateSettings', { stealthMode: e.target.checked });
    document.getElementById('updateEmergencyWhatsappBtn').onclick = () => {
        const emergencyWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        if (emergencyWhatsapp) {
            localStorage.setItem('appEmergencyWhatsapp', emergencyWhatsapp);
            socket.emit('updateSettings', { emergencyWhatsapp });
            alert('تم الحفظ.');
        }
    };
});
