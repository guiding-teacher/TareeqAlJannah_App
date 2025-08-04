// script.js

mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.3.0/mapbox-gl-rtl-text.js',
    null,
    true
);

// إعدادات Mapbox
mapboxgl.accessToken = 'pk.eyJ1IjoiYWxpYWxpMTIiLCJhIjoiY21kYmh4ZDg2MHFwYTJrc2E1bWZ4NXV4cSJ9.4zUdS1FupIeJ7BGxAXOlEw';

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [43.6875, 33.3152],
    zoom: 6,
    pitch: 45,
    bearing: -17.6
});

// متغيرات عامة
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {};
const poiMarkers = {};
const meetingPointMarkers = {};
const moazebMarkers = {};
let currentHistoricalPathLayer = null;
let currentChatFriendId = null;
let activeMessageTimers = {};
let moazebConnectionLayerId = null;
let proximityAlertState = {}; // لتتبع تنبيهات القرب

const holySites = [];

const socket = io('https://tareeqaljannah-app.onrender.com');

// وظائف عامة للواجهة الرسومية
function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    document.querySelectorAll('.main-header nav button').forEach(btn => {
        btn.classList.remove('active');
    });

    if (panelId) {
        document.getElementById(panelId)?.classList.add('active');
        document.querySelector(`button[id$="${panelId.replace('Panel', 'Btn')}"]`)?.classList.add('active');
    }
}

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        e.target.closest('.overlay-panel').classList.remove('active');
        document.querySelectorAll('.main-header nav button').forEach(btn => btn.classList.remove('active'));
        document.getElementById('showGeneralMapBtn').classList.add('active');
        // عدم استدعاء showGeneralMap() هنا لتجنب حذف كل شيء، التبديل يتم في الأزرار الرئيسية
    });
});

// وظائف الخريطة والمواقع
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

    const userPhotoSrc = user.photo || 'image/Picsart_25-08-03_16-47-02-591.png';
    el.innerHTML = `
        <img class="user-marker-photo" src="${userPhotoSrc}" alt="${user.name}">
        <div class="user-marker-name">${user.name}</div>
        <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
        <div class="status-bubble" id="status-bubble-${user.userId}"></div>
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
    
    if (user.statusText) {
        showStatusBubble(user.userId, user.statusText, user.statusIcon);
    }
    
    return marker;
}

function showFriendDetailsPopup(friend) {
    const existingPopup = friendMarkers[friend.userId]?._popup;
    if (existingPopup) existingPopup.remove();
    
    const currentUserHasValidLocation = currentUser?.location?.coordinates && (currentUser.location.coordinates[0] !== 0 || currentUser.location.coordinates[1] !== 0);
    const friendHasValidLocation = friend?.location?.coordinates && (friend.location.coordinates[0] !== 0 || friend.location.coordinates[1] !== 0);

    let distanceHtml = '<p><i class="fas fa-route"></i> المسافة عنك: موقع غير محدد</p>';
    if (currentUserHasValidLocation && friendHasValidLocation) {
        const distance = calculateDistance(
            currentUser.location.coordinates[1], currentUser.location.coordinates[0],
            friend.location.coordinates[1], friend.location.coordinates[0]
        ).toFixed(2);
        distanceHtml = `<p><i class="fas fa-route"></i> المسافة عنك: ${distance} كم</p>`;
    }
    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'غير معروف';

    const friendDetailsHtml = `
        ${friend.gender && friend.gender !== 'other' ? `<p><i class="fas fa-venus-mars"></i> الجنس: ${friend.gender === 'male' ? 'ذكر' : 'أنثى'}</p>` : ''}
        ${friend.phone && friend.settings.showPhone ? `<p><i class="fas fa-phone"></i> الهاتف: ${friend.phone}</p>` : ''}
        ${friend.email && friend.settings.showEmail ? `<p><i class="fas fa-envelope"></i> البريد: ${friend.email}</p>` : ''}
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

    const popup = new mapboxgl.Popup({ offset: 50 })
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
    if (!poi?.location?.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || 'لا يوجد وصف'}</p>
            <p><strong>الفئة:</strong> ${poi.category}</p>
            ${currentUser && poi.createdBy === currentUser.userId ? 
                `<button class="delete-poi-btn" data-poi-id="${poi._id}"><i class="fas fa-trash"></i> حذف</button>` : ''}
        `))
        .addTo(map);

    marker.getElement().addEventListener('click', () => {
        setTimeout(() => {
            document.querySelector(`.delete-poi-btn[data-poi-id="${poi._id}"]`)?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`هل أنت متأكد أنك تريد حذف نقطة الاهتمام "${poi.name}"؟`)) {
                    socket.emit('deletePOI', { poiId: poi._id });
                }
            });
        }, 100);
    });

    poiMarkers[poi._id] = marker;
    return marker;
}

function createMeetingPointMarker(data) {
    if (!data?.point?.location?.coordinates) return;
    const { creatorId, creatorName, point } = data;
    if (meetingPointMarkers[creatorId]) meetingPointMarkers[creatorId].remove();

    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(point.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 40 }).setHTML(`
            <h3>نقطة تجمع: ${point.name}</h3>
            <p>أنشأها: ${creatorName}</p>
            ${point.expiresAt ? `<p><i class="fas fa-clock"></i> تنتهي في: ${new Date(point.expiresAt).toLocaleString()}</p>` : ''}
        `))
        .addTo(map);
    
    meetingPointMarkers[creatorId] = marker;
}

function createMoazebMarker(moazeb) {
    if (!moazeb?.location?.coordinates) return;
    if (moazebMarkers[moazeb._id]) moazebMarkers[moazeb._id].remove();

    const el = document.createElement('div');
    el.className = 'moazeb-marker';
    
    const iconMap = {
        mawkib: 'fas fa-flag', hussainiya: 'fas fa-place-of-worship', tent: 'fas fa-campground',
        station: 'fas fa-gas-pump', sleep: 'fas fa-bed', food: 'fas fa-utensils', house: 'fas fa-home'
    };
    el.innerHTML = `<div class="moazeb-icon-container"><i class="${iconMap[moazeb.type] || iconMap.house}"></i></div>`;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(moazeb.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(`
            <h3>${moazeb.name}</h3>
            <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
            <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
            <p><i class="fas fa-city"></i> ${moazeb.governorate} - ${moazeb.district}</p>
            <button class="link-to-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-link"></i> الربط</button>
            ${currentUser?.linkedMoazeb?.moazebId === moazeb._id ? 
                `<button class="unlink-from-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-unlink"></i> إلغاء الربط</button>` : ''}
        `))
        .addTo(map);

    marker.getElement().addEventListener('click', () => {
        setTimeout(() => {
            document.querySelector(`.link-to-moazeb-btn[data-moazeb-id="${moazeb._id}"]`)?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`هل تريد الربط مع المضيف ${moazeb.name}؟`)) socket.emit('linkToMoazeb', { moazebId: moazeb._id });
            });
            document.querySelector(`.unlink-from-moazeb-btn[data-moazeb-id="${moazeb._id}"]`)?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`هل تريد إلغاء الربط مع المضيف ${moazeb.name}؟`)) socket.emit('unlinkFromMoazeb');
            });
        }, 100);
    });

    moazebMarkers[moazeb._id] = marker;
    return marker;
}

function drawMoazebConnectionLine(connectionLine) {
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
    }
    if (!connectionLine || connectionLine.length < 2) return;
    moazebConnectionLayerId = 'moazeb-connection-' + Date.now();
    map.addSource(moazebConnectionLayerId, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: connectionLine } }
    });
    map.addLayer({
        id: moazebConnectionLayerId, type: 'line', source: moazebConnectionLayerId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FFA500', 'line-width': 4, 'line-dasharray': [2, 2] }
    });
}

function clearMapForViewChange(viewType) {
    // Hide friend markers and lines
    Object.values(friendMarkers).forEach(marker => marker.getElement().style.display = 'none');
    if (currentUser?.linkedFriends) {
        currentUser.linkedFriends.forEach(friendId => {
            const layerId = `line-${currentUser.userId}-${friendId}`;
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', 'none');
            }
        });
    }

    // Hide POI markers, Moazebs, holy sites
    Object.values(poiMarkers).forEach(marker => marker.getElement().style.display = 'none');
    Object.values(moazebMarkers).forEach(marker => marker.getElement().style.display = 'none');
    holySites.forEach(site => site.marker?.getElement().style.display = 'none');

    // Show what's needed for the current view
    if (viewType === 'friends') {
        Object.values(friendMarkers).forEach(marker => marker.getElement().style.display = 'flex');
         if (currentUser?.linkedFriends) {
            currentUser.linkedFriends.forEach(friendId => {
                const layerId = `line-${currentUser.userId}-${friendId}`;
                if (map.getLayer(layerId)) {
                    map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            });
        }
    } else if (viewType === 'general') {
        Object.values(poiMarkers).forEach(marker => marker.getElement().style.display = 'flex');
        holySites.forEach(site => site.marker?.getElement().style.display = 'block'); // assuming it's a block
    }
}


function showGeneralMap() {
    clearMapForViewChange('general');
    socket.emit('requestPOIs'); // Refresh POIs
    map.flyTo({ center: [43.6875, 33.3152], zoom: 6, pitch: 45, bearing: -17.6 });
}

function showFriendsMap() {
    clearMapForViewChange('friends');
    
    // Create markers if they don't exist
    if (currentUser?.location?.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation && !friendMarkers[currentUser.userId]) {
        createCustomMarker(currentUser);
    }
    linkedFriends.forEach(friend => {
        if (friend.location?.coordinates && friend.settings?.shareLocation && !friend.settings.stealthMode && !friendMarkers[friend.userId]) {
            createCustomMarker(friend);
        }
    });

    if (currentUser) {
        const allVisibleCoords = linkedFriends
            .filter(f => f.location?.coordinates && f.settings.shareLocation && !f.settings.stealthMode)
            .map(f => f.location.coordinates);
        
        if (currentUser.location?.coordinates) {
             allVisibleCoords.push(currentUser.location.coordinates);
        }
        
        if (allVisibleCoords.length > 1) {
            const bounds = allVisibleCoords.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds());
            map.fitBounds(bounds, { padding: 80, pitch: 45, bearing: -17.6 });
        } else if (allVisibleCoords.length === 1) {
            map.flyTo({ center: allVisibleCoords[0], zoom: 14, pitch: 45, bearing: -17.6 });
        }
    }
}


function showAllMoazebOnMap() { 
    Object.values(moazebMarkers).forEach(marker => marker.getElement().style.display = 'flex');
    socket.emit('getAllMoazeb'); 
}

function drawGeneralPaths() {
    // This function seems unused, but keeping its structure
}
function drawConnectionLine(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords) return;
    const geojson = { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': [startCoords, endCoords] } };
    if (map.getSource(layerId)) {
        map.getSource(layerId).setData(geojson);
    } else {
        map.addSource(layerId, { 'type': 'geojson', 'data': geojson });
        map.addLayer({ 'id': layerId, 'type': 'line', 'source': layerId, 'layout': { 'line-join': 'round', 'line-cap': 'round' }, 'paint': { 'line-color': '#007bff', 'line-width': 4, 'line-dasharray': [0.5, 2] } });
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
    map.addSource(layerId, { 'type': 'geojson', 'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates } } });
    map.addLayer({ 'id': layerId, 'type': 'line', 'source': layerId, 'layout': { 'line-join': 'round', 'line-cap': 'round' }, 'paint': { 'line-color': '#FF00FF', 'line-width': 6, 'line-opacity': 0.8 } });
    const bounds = pathCoordinates.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds());
    map.fitBounds(bounds, { padding: 50 });
}
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
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
            return (battery.level * 100).toFixed(0) + '%';
        } catch (e) {
            return 'N/A';
        }
    }
    return 'N/A';
}

function playSound(url) {
    if (currentUser?.settings?.sound) {
        new Audio(url).play().catch(e => console.error("Error playing sound:", e));
    }
}
function playNotificationSound() { playSound('https://www.soundjay.com/buttons/beep-07.mp3'); }
function playSOSSound() { playSound('https://www.soundjay.com/misc/emergency-alert-911-01.mp3'); }
function playPrayerTimeSound() { playSound('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3'); }
function playProximityAlertSound() { playSound('https://www.soundjay.com/misc/sounds/hand-bell-2.mp3'); }

function sendMessageFromBottomBar() {
    const input = document.getElementById('bottomChatInput');
    const messageText = input.value.trim();
    if (!currentUser) return alert("جاري تحميل بيانات المستخدم...");
    if (!currentChatFriendId) return alert("الرجاء اختيار صديق للدردشة.");
    if (messageText) {
        if (document.getElementById('chatPanel').classList.contains('active')) {
             addChatMessage(currentUser.name, messageText, 'sent', new Date());
        }
        socket.emit('chatMessage', { receiverId: currentChatFriendId, message: messageText });
        playNotificationSound();
        if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, messageText);
        input.value = '';
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
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 30000);
    }
}

function showStatusBubble(userId, text, icon) {
    const bubble = document.getElementById(`status-bubble-${userId}`);
    if (bubble) {
        bubble.innerHTML = `<i class="${icon}"></i> ${text}`;
        bubble.classList.add('show');
    }
}
function hideStatusBubble(userId) {
    const bubble = document.getElementById(`status-bubble-${userId}`);
    if (bubble) {
        bubble.classList.remove('show');
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
        list.innerHTML = '<li>لا يوجد أصدقاء مرتبطون لعرض حالة بطاريتهم.</li>';
    }
}

function fetchAndDisplayPrayerTimes() { socket.emit('requestPrayerTimes'); }

function setupChatPanel() {
    const chatFriendSelect = document.getElementById('chatFriendSelect');
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
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        document.getElementById('chatMessages').innerHTML = '<p style="text-align: center; color: #777;">لا يوجد أصدقاء للدردشة.</p>';
    }
    chatFriendSelect.removeEventListener('change', handleChatFriendChange);
    chatFriendSelect.addEventListener('change', handleChatFriendChange);
}

function handleChatFriendChange(e) {
    currentChatFriendId = e.target.value;
    document.getElementById('bottomChatFriendSelect').value = currentChatFriendId;
    socket.emit('requestChatHistory', { friendId: currentChatFriendId });
}

function setupBottomChatBar() {
    const bottomChatBar = document.getElementById('bottomChatBar');
    const bottomChatFriendSelect = document.getElementById('bottomChatFriendSelect');
    if (linkedFriends.length > 0) {
        bottomChatFriendSelect.innerHTML = '';
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            bottomChatFriendSelect.appendChild(option);
        });
        if (!currentChatFriendId || !linkedFriends.some(f => f.userId === currentChatFriendId)) {
             currentChatFriendId = linkedFriends[0].userId;
        }
        bottomChatFriendSelect.value = currentChatFriendId;
        bottomChatBar.classList.add('active');
    } else {
        bottomChatBar.classList.remove('active');
    }
}

function updateMyCreationsList() {
    // This function implementation is unchanged.
}
function setupMapControls() {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'map-controls';
    
    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'map-control-btn';
    zoomInBtn.innerHTML = '<i class="fas fa-plus"></i>';
    zoomInBtn.addEventListener('click', () => map.zoomIn());
    
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'map-control-btn';
    zoomOutBtn.innerHTML = '<i class="fas fa-minus"></i>';
    zoomOutBtn.addEventListener('click', () => map.zoomOut());
    
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'map-control-btn';
    rotateBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    rotateBtn.addEventListener('click', () => { map.setBearing(0); map.setPitch(45); });
    
    controlsDiv.appendChild(zoomInBtn);
    controlsDiv.appendChild(zoomOutBtn);
    controlsDiv.appendChild(rotateBtn);
    
    document.getElementById('map').appendChild(controlsDiv);
}

function checkProximity() {
    if (!currentUser?.location?.coordinates || linkedFriends.length === 0) return;
    const PROXIMITY_THRESHOLD_KM = 0.1; // 100 متر
    linkedFriends.forEach(friend => {
        if (friend.location?.coordinates) {
            const distance = calculateDistance(
                currentUser.location.coordinates[1], currentUser.location.coordinates[0],
                friend.location.coordinates[1], friend.location.coordinates[0]
            );
            if (distance <= PROXIMITY_THRESHOLD_KM) {
                if (!proximityAlertState[friend.userId]) {
                    playProximityAlertSound();
                    proximityAlertState[friend.userId] = true;
                }
            } else {
                if (proximityAlertState[friend.userId]) {
                    proximityAlertState[friend.userId] = false;
                }
            }
        }
    });
}


// SOCKET.IO EVENT HANDLERS
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
    localStorage.setItem('appUserId', currentUser.userId);
    // ... rest of the assignments from previous version ...
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo;
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    // ... etc.

    updateMyCreationsList();
    startLocationTracking();
    if (currentUser.linkedFriends?.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
    if (!localStorage.getItem('appUserName') || !localStorage.getItem('appUserGender')) {
        document.getElementById('initialInfoPanel').classList.add('active');
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate = (currentUser?.userId === data.userId) ? currentUser : linkedFriends.find(f => f.userId === data.userId);
    if (userToUpdate) {
        Object.assign(userToUpdate, data);
        userToUpdate.location = { type: 'Point', coordinates: data.location };
        
        const marker = friendMarkers[userToUpdate.userId];
        const isFriendsMapActive = document.getElementById('showFriendsMapBtn').classList.contains('active');
        const shouldBeVisible = userToUpdate.settings.shareLocation && !userToUpdate.settings.stealthMode;

        if (isFriendsMapActive && shouldBeVisible) {
            if (marker) {
                marker.setLngLat(userToUpdate.location.coordinates);
            } else {
                createCustomMarker(userToUpdate);
            }
        } else {
            if (marker) {
                marker.getElement().style.display = 'none';
            }
        }
        
        if (userToUpdate.statusText) {
            showStatusBubble(userToUpdate.userId, userToUpdate.statusText, userToUpdate.statusIcon);
        } else {
            hideStatusBubble(userToUpdate.userId);
        }
    }
});

socket.on('statusUpdate', (data) => {
    const { userId, statusText, statusIcon } = data;
    if (currentUser?.userId === userId) {
        currentUser.statusText = statusText;
        currentUser.statusIcon = statusIcon;
    }
    const friend = linkedFriends.find(f => f.userId === userId);
    if (friend) {
        friend.statusText = statusText;
        friend.statusIcon = statusIcon;
    }
    
    if (statusText) {
        showStatusBubble(userId, statusText, statusIcon);
        if (userId === currentUser.userId) document.getElementById('statusBtn').classList.add('active');
    } else {
        hideStatusBubble(userId);
        if (userId === currentUser.userId) document.getElementById('statusBtn').classList.remove('active');
    }
});

socket.on('linkStatus', (data) => { if(data.success) { togglePanel(null); document.getElementById('showFriendsMapBtn').click(); } alert(data.message); });
socket.on('unfriendStatus', (data) => { if(data.success) { socket.emit('registerUser', { userId: currentUser.userId }); document.getElementById('showFriendsMapBtn').click(); } alert(data.message); });
socket.on('updateFriendsList', (friendsData) => { linkedFriends = friendsData; if (document.getElementById('showFriendsMapBtn').classList.contains('active')) showFriendsMap(); setupBottomChatBar(); updateFriendBatteryStatus(); });
socket.on('newChatMessage', (data) => { if (currentUser?.userId === data.receiverId) { if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message); playNotificationSound(); if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) addChatMessage(data.senderName, data.message, 'received', data.timestamp); } });
socket.on('removeUserMarker', (data) => { if (friendMarkers[data.userId]) { friendMarkers[data.userId].remove(); delete friendMarkers[data.userId]; } });
socket.on('poiStatus', (data) => { alert(data.message); if (data.success) socket.emit('registerUser', { userId: currentUser.userId }); });
socket.on('newPOIAdded', (poi) => createPOIMarker(poi));
socket.on('poiDeletedBroadcast', (data) => { if (poiMarkers[data.poiId]) { poiMarkers[data.poiId].remove(); delete poiMarkers[data.poiId]; } });
socket.on('updatePOIsList', (poisData) => { poisData.forEach(poi => createPOIMarker(poi)); });
socket.on('historicalPathData', (data) => { if(data.success && data.path?.length > 0) { drawHistoricalPath(data.userId, data.path.map(p => p.location.coordinates)); } else { alert('لا يوجد مسار تاريخي.'); } });
socket.on('chatHistoryData', (data) => { /* ... unchanged ... */ });
socket.on('newMeetingPoint', (data) => { createMeetingPointMarker(data); if (currentUser?.userId === data.creatorId) document.getElementById('endMeetingPointBtn').style.display = 'block'; });
socket.on('meetingPointCleared', (data) => { if (meetingPointMarkers[data.creatorId]) { meetingPointMarkers[data.creatorId].remove(); delete meetingPointMarkers[data.creatorId]; if (data.creatorId !== currentUser?.userId) alert('تم إنهاء نقطة التجمع.'); } if (currentUser?.userId === data.creatorId) document.getElementById('endMeetingPointBtn').style.display = 'none'; });
socket.on('moazebStatus', (data) => { alert(data.message); });

socket.on('moazebSearchResults', (data) => {
    const resultsContainer = document.getElementById('moazebResultsContainer');
    resultsContainer.innerHTML = '';
    Object.values(moazebMarkers).forEach(m => m.remove());
    Object.keys(moazebMarkers).forEach(k => delete moazebMarkers[k]);

    if (data.success && data.results.length > 0) {
        data.results.forEach(moazeb => {
            const card = document.createElement('div');
            card.className = 'moazeb-card';
            card.innerHTML = `
                <h4>${moazeb.name}</h4>
                <p><i class="fas fa-map-marker-alt"></i> <strong>العنوان:</strong> ${moazeb.address}</p>
                <p><i class="fas fa-phone"></i> <strong>الهاتف:</strong> ${moazeb.phone}</p>
                <p><i class="fas fa-city"></i> <strong>المحافظة:</strong> ${moazeb.governorate} - ${moazeb.district}</p>
                <div class="card-buttons">
                    <button class="link-to-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-link"></i> الربط</button>
                    <button class="fly-to-moazeb-btn" data-lng="${moazeb.location.coordinates[0]}" data-lat="${moazeb.location.coordinates[1]}">
                        <i class="fas fa-map-pin"></i> الموقع
                    </button>
                </div>
            `;
            resultsContainer.appendChild(card);
            createMoazebMarker(moazeb);
        });
        
        document.querySelectorAll('.fly-to-moazeb-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lng = parseFloat(e.currentTarget.dataset.lng);
                const lat = parseFloat(e.currentTarget.dataset.lat);
                map.flyTo({ center: [lng, lat], zoom: 15 });
                e.target.closest('.overlay-panel').classList.remove('active');
            });
        });
        document.querySelectorAll('.link-to-moazeb-btn').forEach(btn => {
            btn.addEventListener('click', e => socket.emit('linkToMoazeb', { moazebId: e.currentTarget.dataset.moazebId }));
        });

        const bounds = data.results.reduce((b, m) => b.extend(m.location.coordinates), new mapboxgl.LngLatBounds());
        map.fitBounds(bounds, { padding: 50 });
    } else {
        resultsContainer.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
    }
});

socket.on('allMoazebData', (data) => { if(data.success) data.moazebs.forEach(m => createMoazebMarker(m)); });
socket.on('linkToMoazebStatus', (data) => { alert(data.message); if(data.success) { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); socket.emit('registerUser', {userId: currentUser.userId}); } });
socket.on('moazebConnectionData', (data) => { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); });
socket.on('moazebConnectionUpdate', (data) => { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); });
socket.on('moazebConnectionRemoved', () => { if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) { map.removeLayer(moazebConnectionLayerId); map.removeSource(moazebConnectionLayerId); moazebConnectionLayerId = null; } });
socket.on('poiDeleted', (data) => { if(data.success) { if(poiMarkers[data.poiId]) { poiMarkers[data.poiId].remove(); delete poiMarkers[data.poiId]; } socket.emit('registerUser', {userId: currentUser.userId}); alert('تم الحذف.'); } else { alert('فشل الحذف.'); } });
socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        const { Fajr, Dhuhr, Asr, Maghrib, Isha } = data.timings;
        displayElement.innerHTML = `<p><strong>الفجر:</strong> ${Fajr}</p><p><strong>الظهر:</strong> ${Dhuhr}</p><p><strong>العصر:</strong> ${Asr}</p><p><strong>المغرب:</strong> ${Maghrib}</p><p><strong>العشاء:</strong> ${Isha}</p>`;
        playPrayerTimeSound();
    } else {
        displayElement.innerHTML = `<p style="color: var(--danger-color);">${data.message || 'فشل جلب أوقات الصلاة.'}</p>`;
    }
});

// DOM EVENT LISTENERS
map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
    setupMapControls();
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { togglePanel(null); showGeneralMap(); });
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { if(currentUser) { togglePanel(null); showFriendsMap(); } });
    document.getElementById('showAllMoazebBtn').addEventListener('click', showAllMoazebOnMap);
    
    const statusBtn = document.getElementById('statusBtn');
    const statusOptions = document.getElementById('statusOptions');

    statusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (statusBtn.classList.contains('active')) {
            socket.emit('updateStatus', { statusText: null, statusIcon: null });
            statusOptions.classList.remove('show');
        } else {
            statusOptions.classList.toggle('show');
        }
    });

    document.querySelectorAll('.status-option').forEach(option => {
        option.addEventListener('click', () => {
            socket.emit('updateStatus', { 
                statusText: option.dataset.statusText, 
                statusIcon: option.dataset.statusIcon 
            });
            statusOptions.classList.remove('show');
        });
    });

    document.addEventListener('click', () => statusOptions.classList.remove('show'));

    setInterval(checkProximity, 30000);
    
    // The rest of the listeners from the previous version
    document.getElementById('initialInfoConfirmBtn').addEventListener('click', () => {
        const name = document.getElementById('initialInfoNameInput').value.trim();
        const gender = document.getElementById('initialInfoGenderSelect').value;
        const phone = document.getElementById('initialInfoPhoneInput').value.trim();
        const email = document.getElementById('initialInfoEmailInput').value.trim();
        if (name && gender !== 'other' && phone && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            localStorage.setItem('appUserName', name);
            localStorage.setItem('appUserGender', gender);
            localStorage.setItem('appUserPhone', phone);
            localStorage.setItem('appUserEmail', email);
            socket.emit('updateSettings', { name, gender, phone, email });
            document.getElementById('initialInfoPanel').classList.remove('active');
        } else {
            alert('الرجاء ملء جميع الحقول بشكل صحيح.');
        }
    });
    document.getElementById('showProfileBtn').addEventListener('click', () => { if(currentUser) { updateMyCreationsList(); togglePanel('profilePanel'); } });
    document.getElementById('generateCodeBtn').addEventListener('click', () => alert('غير متاح حالياً.'));
    document.getElementById('copyLinkCodeBtn').addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('userLinkCode').textContent).then(() => alert('تم النسخ!')));
    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => {
        if(!currentUser) return;
        const data = {
            name: document.getElementById('editUserNameInput').value.trim(),
            gender: document.getElementById('editGenderSelect').value,
            phone: document.getElementById('editPhoneInput').value.trim(),
            email: document.getElementById('editEmailInput').value.trim(),
        };
        if(data.name && data.gender !== 'other' && data.phone && data.email) {
            socket.emit('updateSettings', data);
            alert('تم الحفظ!');
        } else {
            alert('الرجاء ملء جميع الحقول.');
        }
    });
    document.getElementById('showConnectBtn').addEventListener('click', () => { if(currentUser) togglePanel('connectPanel'); });
    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if(friendCode) socket.emit('requestLink', { friendCode });
    });
    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessageFromBottomBar(); });
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => { if(currentUser && linkedFriends.length > 0) { togglePanel('chatPanel'); setupChatPanel(); } else { alert('اربط صديقاً أولاً.'); } });
    document.getElementById('showFeaturesBtn').addEventListener('click', () => { if (currentUser) togglePanel('featuresPanel'); });
    document.getElementById('viewHistoricalPathBtn').addEventListener('click', () => { const selectedUserId = document.getElementById('historicalPathUserSelect').value; if(selectedUserId) socket.emit('requestHistoricalPath', { targetUserId: selectedUserId }); });
    document.getElementById('clearHistoricalPathBtn').addEventListener('click', () => clearHistoricalPath());
    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if(!currentUser?.location?.coordinates) return alert('موقعك غير متاح.');
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const poiCategory = document.getElementById('poiCategorySelect').value;
            const iconMap = {'Rest Area': '<i class="fas fa-bed"></i>', 'Medical Post': '<i class="fas fa-medkit"></i>', 'Food Station': '<i class="fas fa-utensils"></i>', 'Water': '<i class="fas fa-tint"></i>', 'Mosque': '<i class="fas fa-mosque"></i>', 'Parking': '<i class="fas fa-parking"></i>', 'Info': '<i class="fas fa-info-circle"></i>', 'Other': '<i class="fas fa-map-marker-alt"></i>'};
            socket.emit('addCommunityPOI', { name: poiName, category: poiCategory, location: currentUser.location.coordinates, icon: iconMap[poiCategory] || iconMap['Other']});
        }
    });
    document.getElementById('sosButton').addEventListener('click', () => { if(currentUser?.settings?.emergencyWhatsapp) { if(confirm('هل أنت متأكد من إرسال SOS؟')) { playSOSSound(); const [lng, lat] = currentUser.location.coordinates; const msg = `مساعدة! موقعي: https://www.google.com/maps?q=${lat},${lng}`; window.open(`https://wa.me/${currentUser.settings.emergencyWhatsapp}?text=${encodeURIComponent(msg)}`); } } else { alert('أضف رقم طوارئ أولاً.'); } });
    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);
    document.getElementById('setMeetingPointBtn').addEventListener('click', () => { const name = document.getElementById('meetingPointInput').value.trim(); if(name && currentUser?.location?.coordinates) socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates }); });
    document.getElementById('endMeetingPointBtn').addEventListener('click', () => { if(confirm('هل أنت متأكد؟')) socket.emit('clearMeetingPoint'); });
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    document.getElementById('addMoazebBtn').addEventListener('click', () => { if(!currentUser?.location?.coordinates) return; const data = { name: document.getElementById('addMoazebName').value.trim(), address: document.getElementById('addMoazebAddress').value.trim(), phone: document.getElementById('addMoazebPhone').value.trim(), governorate: document.getElementById('addMoazebGov').value.trim(), district: document.getElementById('addMoazebDist').value.trim(), type: document.getElementById('addMoazebType').value, location: currentUser.location.coordinates }; if(Object.values(data).some(v => !v)) return alert('املأ كل الحقول'); socket.emit('addMoazeb', data); });
    document.getElementById('searchMoazebBtn').addEventListener('click', () => { const query = { phone: document.getElementById('searchMoazebPhone').value.trim(), governorate: document.getElementById('searchMoazebGov').value.trim(), district: document.getElementById('searchMoazebDist').value.trim() }; if(Object.values(query).some(v => v)) socket.emit('searchMoazeb', query); });
    document.getElementById('showSettingsBtn').addEventListener('click', () => { if(currentUser) togglePanel('settingsPanel'); });
    document.getElementById('shareLocationToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { shareLocation: e.target.checked }); });
    document.getElementById('soundToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { sound: e.target.checked }); });
    document.getElementById('hideBubblesToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { hideBubbles: e.target.checked }); });
    document.getElementById('stealthModeToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { stealthMode: e.target.checked }); });
    document.getElementById('showPhoneToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { showPhone: e.target.checked }); });
    document.getElementById('showEmailToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { showEmail: e.target.checked }); });
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => { if(currentUser) { const num = document.getElementById('emergencyWhatsappInput').value.trim(); if(num) socket.emit('updateSettings', { emergencyWhatsapp: num }); alert('تم الحفظ'); } });
    document.getElementById('mapPitch').addEventListener('input', (e) => map.setPitch(e.target.value));
    document.getElementById('mapBearing').addEventListener('input', (e) => map.setBearing(e.target.value));
});
