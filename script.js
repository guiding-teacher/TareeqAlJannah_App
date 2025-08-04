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

// المواقع الرئيسية في العراق
const holySites = [];

// اتصال Socket.IO
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
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('showGeneralMapBtn').classList.add('active');
        showGeneralMap();
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
    
    const userPhotoSrc = user.photo && user.photo !== '' ? user.photo : 'image/Picsart_25-08-03_16-47-02-591.png';

    // *** تعديل: إضافة حاوية لفقاعة الحالة ***
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

    // *** تعديل: إظهار الحالة الحالية عند إنشاء الأيقونة ***
    if (user.statusText) {
        showStatusBubble(user.userId, user.statusText, user.statusIcon);
    }

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
    if (!poi || !poi.location || !poi.location.coordinates) {
        return null;
    }

    if (poiMarkers[poi._id]) {
        poiMarkers[poi._id].remove();
    }

    const el = document.createElement('div');
    el.className = 'poi-marker';
    let iconHtml = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    el.innerHTML = iconHtml;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(`
            <h3>${poi.name}</h3>
            <p>${poi.description || 'لا يوجد وصف'}</p>
            <p><strong>الفئة:</strong> ${poi.category}</p>
            ${currentUser && poi.createdBy === currentUser.userId ? 
                `<button class="delete-poi-btn" data-poi-id="${poi._id}">
                    <i class="fas fa-trash"></i> حذف
                </button>` : ''}
        `))
        .addTo(map);

    marker.getElement().addEventListener('click', () => {
        setTimeout(() => {
            const deleteBtn = document.querySelector(`.delete-poi-btn[data-poi-id="${poi._id}"]`);
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`هل أنت متأكد أنك تريد حذف نقطة الاهتمام "${poi.name}"؟`)) {
                        socket.emit('deletePOI', { poiId: poi._id });
                    }
                });
            }
        }, 100);
    });

    poiMarkers[poi._id] = marker;
    return marker;
}

function createMeetingPointMarker(data) {
    const { creatorId, creatorName, point } = data;
    if (!point || !point.location || !point.location.coordinates) return;

    if (meetingPointMarkers[creatorId]) {
        meetingPointMarkers[creatorId].remove();
    }

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
    if (!moazeb || !moazeb.location || !moazeb.location.coordinates) return;

    if (moazebMarkers[moazeb._id]) {
        moazebMarkers[moazeb._id].remove();
    }

    const el = document.createElement('div');
    el.className = 'moazeb-marker';
    
    let iconClass;
    switch(moazeb.type) {
        case 'mawkib': iconClass = 'fas fa-flag'; break;
        case 'hussainiya': iconClass = 'fas fa-place-of-worship'; break;
        case 'tent': iconClass = 'fas fa-campground'; break;
        case 'station': iconClass = 'fas fa-gas-pump'; break;
        case 'sleep': iconClass = 'fas fa-bed'; break;
        case 'food': iconClass = 'fas fa-utensils'; break;
        default: iconClass = 'fas fa-home';
    }
    
    el.innerHTML = `
        <div class="moazeb-icon-container">
            <i class="${iconClass}"></i>
        </div>
    `;

    el.style.backgroundColor = '#006400';
    el.style.color = 'white';
    el.style.borderRadius = '50%';
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';

    const marker = new mapboxgl.Marker(el)
        .setLngLat(moazeb.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(`
            <h3>${moazeb.name}</h3>
            <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
            <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
            <p><i class="fas fa-city"></i> ${moazeb.governorate} - ${moazeb.district}</p>
            <button class="link-to-moazeb-btn" data-moazeb-id="${moazeb._id}">
                <i class="fas fa-link"></i> الربط بالمضيف
            </button>
            ${currentUser && currentUser.linkedMoazeb && currentUser.linkedMoazeb.moazebId === moazeb._id ? 
                `<button class="unlink-from-moazeb-btn" data-moazeb-id="${moazeb._id}">
                    <i class="fas fa-unlink"></i> إلغاء الربط
                </button>` : ''}
        `))
        .addTo(map);

    marker.getElement().addEventListener('click', () => {
        setTimeout(() => {
            const linkBtn = document.querySelector(`.link-to-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (linkBtn) {
                linkBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`هل تريد الربط مع المضيف ${moazeb.name}؟`)) {
                        socket.emit('linkToMoazeb', { moazebId: moazeb._id });
                    }
                });
            }
            
            const unlinkBtn = document.querySelector(`.unlink-from-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (unlinkBtn) {
                unlinkBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`هل تريد إلغاء الربط مع المضيف ${moazeb.name}؟`)) {
                        socket.emit('unlinkFromMoazeb');
                    }
                });
            }
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

function clearMapForNewView() {
    // حذف علامات الأصدقاء وخطوط الربط
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);
    if (currentUser && currentUser.linkedFriends) {
        currentUser.linkedFriends.forEach(friendId => {
            const layerId = `line-${currentUser.userId}-${friendId}`;
             if (map.getSource(layerId)) {
                map.removeLayer(layerId);
                map.removeSource(layerId);
            }
        });
    }

    // حذف علامات المعزبين
    Object.values(moazebMarkers).forEach(marker => marker.remove());
    Object.keys(moazebMarkers).forEach(key => delete moazebMarkers[key]);

    // حذف علامات POIs
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    
    // حذف المسارات
    clearHistoricalPath();
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
        moazebConnectionLayerId = null;
    }

    if (map.getSource('general-paths')) {
        map.removeLayer('general-paths');
        map.removeSource('general-paths');
    }

    holySites.forEach(site => site.marker?.remove());
}


function showGeneralMap() {
    clearMapForNewView(); // تنظيف الخريطة

    // إعادة عرض نقاط التجمع إذا كانت موجودة
    Object.values(meetingPointMarkers).forEach(marker => marker.addTo(map));
    
    holySites.forEach(site => {
        if (!site.marker) {
            const el = document.createElement('div');
            el.className = 'holy-site-marker';
            el.innerHTML = site.icon || '<i class="fas fa-star"></i>';
            site.marker = new mapboxgl.Marker(el)
                .setLngLat(site.coords)
                .setPopup(new mapboxgl.Popup().setHTML(`<h3>${site.name}</h3><p>موقع مهم</p>`))
                .addTo(map);
        } else {
            site.marker.addTo(map);
        }
    });

    socket.emit('requestPOIs');
    drawGeneralPaths();

    map.flyTo({ center: [43.6875, 33.3152], zoom: 6, pitch: 45, bearing: -17.6 });
}

function showFriendsMap() {
    clearMapForNewView(); // تنظيف الخريطة
    
    // إعادة عرض نقاط التجمع إذا كانت موجودة
    Object.values(meetingPointMarkers).forEach(marker => marker.addTo(map));
    
    if (currentUser?.location?.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
    }
    
    linkedFriends.forEach(friend => {
        if (friend.location?.coordinates && friend.settings?.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });

    if (currentUser?.location?.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        linkedFriends.forEach(friend => {
            if (friend.location?.coordinates && friend.settings?.shareLocation && !friend.settings.stealthMode) {
                drawConnectionLine(currentUser.location.coordinates, friend.location.coordinates, `line-${currentUser.userId}-${friend.userId}`);
            }
        });
    }

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
    socket.emit('getAllMoazeb');
}

function drawGeneralPaths() {
    const pathCoordinates = [].filter(Boolean);
    if (pathCoordinates.length < 2) {
        if (map.getSource('general-paths')) {
            map.removeLayer('general-paths');
            map.removeSource('general-paths');
        }
        return;
    }
    const geojson = {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'LineString', 'coordinates': pathCoordinates}};
    if (map.getSource('general-paths')) {
        map.getSource('general-paths').setData(geojson);
    } else {
        map.addSource('general-paths', {'type': 'geojson', 'data': geojson});
        map.addLayer({'id': 'general-paths', 'type': 'line', 'source': 'general-paths', 'layout': {'line-join': 'round', 'line-cap': 'round'}, 'paint': {'line-color': '#8A2BE2', 'line-width': 5, 'line-opacity': 0.7}});
    }
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
    if (pathCoordinates.length < 2) {
        console.warn("لا توجد نقاط كافية لرسم المسار التاريخي.");
        return;
    }
    const layerId = `historical-path-${userId}`;
    currentHistoricalPathLayer = layerId;
    map.addSource(layerId, { 'type': 'geojson', 'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates } } });
    map.addLayer({ 'id': layerId, 'type': 'line', 'source': layerId, 'layout': { 'line-join': 'round', 'line-cap': 'round' }, 'paint': { 'line-color': '#FF00FF', 'line-width': 6, 'line-opacity': 0.8 } });
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
    const distance = R * c;
    return distance;
}

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
                userId: currentUser.userId,
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
        } catch (e) {
            console.error("خطأ في جلب حالة البطارية:", e);
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
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #999;">جاري تحميل الرسائل...</p>';
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        currentChatFriendId = null;
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #777;">لا يوجد أصدقاء للدردشة.</p>';
    }
    chatFriendSelect.removeEventListener('change', handleChatFriendChange);
    chatFriendSelect.addEventListener('change', handleChatFriendChange);
}

function handleChatFriendChange(e) {
    currentChatFriendId = e.target.value;
    document.getElementById('bottomChatFriendSelect').value = currentChatFriendId;
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #999;">جاري تحميل الرسائل...</p>';
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
        currentChatFriendId = null;
    }
    bottomChatFriendSelect.removeEventListener('change', (e) => { currentChatFriendId = e.target.value; });
    bottomChatFriendSelect.addEventListener('change', (e) => { currentChatFriendId = e.target.value; });
}

function updateMyCreationsList() {
    const listContainer = document.getElementById('myCreationsList');
    const poisListContainer = document.getElementById('userPOIsList');
    if (!listContainer || !poisListContainer || !currentUser) return;

    listContainer.innerHTML = ''; 
    poisListContainer.innerHTML = '';

    let contentAdded = false;

    if (currentUser.meetingPoint && currentUser.meetingPoint.name) {
        const mpDiv = document.createElement('div');
        mpDiv.innerHTML = `<p style="margin: 5px 0;"><strong>نقطة تجمع:</strong> ${currentUser.meetingPoint.name}</p>`;
        listContainer.appendChild(mpDiv);
        contentAdded = true;
    }

    if (currentUser.createdPOIs && currentUser.createdPOIs.length > 0) {
        const poisTitle = document.createElement('p');
        poisTitle.innerHTML = `<strong>نقاط الاهتمام (${currentUser.createdPOIs.length}):</strong>`;
        listContainer.appendChild(poisTitle);

        const ul = document.createElement('ul');
        ul.style.paddingRight = '20px';
        currentUser.createdPOIs.forEach(poi => {
            const li = document.createElement('li');
            li.textContent = `${poi.name} (${poi.category})`;
            ul.appendChild(li);
            
            const poiLi = document.createElement('li');
            poiLi.innerHTML = `${poi.name} (${poi.category}) 
                <button class="delete-poi-btn-small" data-poi-id="${poi._id}">
                    <i class="fas fa-trash"></i>
                </button>`;
            poisListContainer.appendChild(poiLi);
            
            poiLi.querySelector('.delete-poi-btn-small').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`هل أنت متأكد أنك تريد حذف نقطة الاهتمام "${poi.name}"؟`)) {
                    socket.emit('deletePOI', { poiId: poi._id });
                }
            });
        });
        listContainer.appendChild(ul);
        contentAdded = true;
    }

    if (!contentAdded) {
        listContainer.innerHTML = '<p class="feature-info">لم تقم بإضافة أي نقاط تجمع أو اهتمام بعد.</p>';
    }
}

function setupMapControls() {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'map-controls';
    
    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'map-control-btn';
    zoomInBtn.innerHTML = '<i class="fas fa-plus"></i>';
    zoomInBtn.title = 'تكبير';
    zoomInBtn.addEventListener('click', () => map.zoomIn());
    
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'map-control-btn';
    zoomOutBtn.innerHTML = '<i class="fas fa-minus"></i>';
    zoomOutBtn.title = 'تصغير';
    zoomOutBtn.addEventListener('click', () => map.zoomOut());
    
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'map-control-btn';
    rotateBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    rotateBtn.title = 'تدوير الخريطة';
    rotateBtn.addEventListener('click', () => {
        map.setBearing(0);
        map.setPitch(45);
    });
    
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
                    console.log(`أنت قريب من ${friend.name}!`);
                    playProximityAlertSound();
                    proximityAlertState[friend.userId] = true; // منع التنبيه المتكرر
                }
            } else {
                if (proximityAlertState[friend.userId]) {
                    proximityAlertState[friend.userId] = false;
                }
            }
        }
    });
}

// التعامل مع أحداث WebSocket
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const userName = localStorage.getItem('appUserName') || null;
    const userPhoto = localStorage.getItem('appUserPhoto') || null;
    const gender = localStorage.getItem('appUserGender') || null;
    const phone = localStorage.getItem('appUserPhone') || null;
    const email = localStorage.getItem('appUserEmail') || null;
    const emergencyWhatsapp = localStorage.getItem('appEmergencyWhatsapp') || null;
    socket.emit('registerUser', { userId, name: userName, photo: userPhoto, gender, phone, email, emergencyWhatsapp });
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('تم استقبال بيانات المستخدم الحالي من الخادم:', currentUser);
    localStorage.setItem('appUserId', currentUser.userId);
    localStorage.setItem('appUserName', currentUser.name);
    localStorage.setItem('appUserPhoto', currentUser.photo);
    localStorage.setItem('appUserGender', currentUser.gender || '');
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
    document.getElementById('initialInfoNameInput').value = currentUser.name;
    document.getElementById('initialInfoGenderSelect').value = currentUser.gender || 'other';
    document.getElementById('initialInfoPhoneInput').value = currentUser.phone || '';
    document.getElementById('initialInfoEmailInput').value = currentUser.email || '';
    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;
    document.getElementById('showPhoneToggle').checked = currentUser.settings.showPhone;
    document.getElementById('showEmailToggle').checked = currentUser.settings.showEmail;

    updateMyCreationsList();
    startLocationTracking();
    if (currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
    if (!localStorage.getItem('appUserName') || !localStorage.getItem('appUserGender') || localStorage.getItem('appUserGender') === 'other' || !localStorage.getItem('appUserPhone') || !localStorage.getItem('appUserEmail')) {
        document.getElementById('initialInfoPanel').classList.add('active');
    } else {
        document.getElementById('initialInfoPanel').classList.remove('active');
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
                marker.remove();
                delete friendMarkers[userToUpdate.userId];
            }
        }
        
        if (isFriendsMapActive && currentUser && currentUser.userId !== userToUpdate.userId && shouldBeVisible) {
             const currentUserIsVisible = currentUser.settings.shareLocation && !currentUser.settings.stealthMode;
             if (currentUserIsVisible && currentUser.location && currentUser.location.coordinates) {
                  drawConnectionLine(currentUser.location.coordinates, userToUpdate.location.coordinates, `line-${currentUser.userId}-${userToUpdate.userId}`);
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
        socket.emit('registerUser', { userId: currentUser.userId });
        document.getElementById('showFriendsMapBtn').click();
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
        showFriendsMap();
    }
    setupBottomChatBar();
    if (document.getElementById('connectPanel').classList.contains('active')) {
        const friendsListEl = document.getElementById('friendsList');
        friendsListEl.innerHTML = '';
        if (linkedFriends.length > 0) {
            linkedFriends.forEach(friend => {
                const li = document.createElement('li');
                li.innerHTML = `<img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;"> <span>${friend.name}</span> <span style="margin-right: auto; font-size: 0.9em; color: #666;">${friend.batteryStatus || 'N/A'}</span> <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}"><i class="fas fa-user-minus"></i></button>`;
                friendsListEl.appendChild(li);
            });
            document.querySelectorAll('.unfriend-in-list-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const friendIdToUnlink = e.currentTarget.dataset.friendId;
                    const friendName = linkedFriends.find(f => f.userId === friendIdToUnlink)?.name || 'هذا الصديق';
                    if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friendName}؟`)) {
                        socket.emit('unfriendUser', { friendId: friendIdToUnlink });
                    }
                });
            });
        } else {
            friendsListEl.innerHTML = '<li style="text-align: center; color: #777;">لا يوجد أصدقاء مرتبطون.</li>';
        }
    }
    updateFriendBatteryStatus();
});

socket.on('newChatMessage', (data) => {
    if (currentUser && data.receiverId === currentUser.userId) {
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
    if (currentUser && map.getSource(`line-${currentUser.userId}-${data.userId}`)) {
        map.removeLayer(`line-${currentUser.userId}-${data.userId}`);
        map.removeSource(`line-${currentUser.userId}-${data.userId}`);
    }
    if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
        showFriendsMap();
    }
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if (data.success) {
        socket.emit('registerUser', { userId: currentUser.userId });
    }
});

socket.on('newPOIAdded', (poi) => { createPOIMarker(poi); });
socket.on('poiDeletedBroadcast', (data) => { if (poiMarkers[data.poiId]) { poiMarkers[data.poiId].remove(); delete poiMarkers[data.poiId]; } });
socket.on('updatePOIsList', (poisData) => { Object.values(poiMarkers).forEach(m => m.remove()); poisData.forEach(p => createPOIMarker(p)); });
socket.on('historicalPathData', (data) => { /* ... (unchanged) ... */ });
socket.on('chatHistoryData', (data) => { /* ... (unchanged) ... */ });

socket.on('newMeetingPoint', (data) => {
    createMeetingPointMarker(data);
    if (currentUser?.userId === data.creatorId) document.getElementById('endMeetingPointBtn').style.display = 'block';
});

socket.on('meetingPointCleared', (data) => {
    if (meetingPointMarkers[data.creatorId]) {
        meetingPointMarkers[data.creatorId].remove();
        delete meetingPointMarkers[data.creatorId];
        if (data.creatorId !== currentUser?.userId) alert('تم إنهاء نقطة التجمع.');
    }
    if (currentUser?.userId === data.creatorId) document.getElementById('endMeetingPointBtn').style.display = 'none';
});

socket.on('moazebStatus', (data) => { /* ... (unchanged) ... */ });

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
            btn.addEventListener('click', (e) => {
                const moazebId = e.currentTarget.dataset.moazebId;
                if(confirm(`هل تريد الربط مع هذا المضيف؟`)) socket.emit('linkToMoazeb', { moazebId });
            });
        });
        
        const bounds = data.results.reduce((b, m) => b.extend(m.location.coordinates), new mapboxgl.LngLatBounds());
        map.fitBounds(bounds, { padding: 50 });

    } else {
        resultsContainer.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
    }
});


socket.on('allMoazebData', (data) => { /* ... (unchanged) ... */ });
socket.on('linkToMoazebStatus', (data) => { alert(data.message); if(data.success) { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); socket.emit('registerUser', {userId: currentUser.userId}); } });
socket.on('moazebConnectionData', (data) => { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); });
socket.on('moazebConnectionUpdate', (data) => { if(data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); });
socket.on('moazebConnectionRemoved', () => { if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) { map.removeLayer(moazebConnectionLayerId); map.removeSource(moazebConnectionLayerId); moazebConnectionLayerId = null; } });
socket.on('poiDeleted', (data) => { /* ... (unchanged) ... */ });

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

map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
    setupMapControls();
});

document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { togglePanel(null); showGeneralMap(); });
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { if(!currentUser) return; togglePanel(null); showFriendsMap(); });
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
            const statusText = option.dataset.statusText;
            const statusIcon = option.dataset.statusIcon;
            socket.emit('updateStatus', { statusText, statusIcon });
            statusOptions.classList.remove('show');
        });
    });

    document.addEventListener('click', () => { statusOptions.classList.remove('show'); });
    setInterval(checkProximity, 30000);

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
            alert('تم حفظ معلوماتك بنجاح.');
        } else {
            alert('الرجاء ملء جميع الحقول بشكل صحيح.');
        }
    });

    document.getElementById('showProfileBtn').addEventListener('click', () => { if(currentUser) { updateMyCreationsList(); togglePanel('profilePanel'); } });
    document.getElementById('generateCodeBtn').addEventListener('click', () => alert('غير متاح حالياً.'));
    document.getElementById('copyLinkCodeBtn').addEventListener('click', () => {
        const linkCode = document.getElementById('userLinkCode').textContent;
        if (linkCode) navigator.clipboard.writeText(linkCode).then(() => alert('تم النسخ!'));
    });
    
    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => {
        if(!currentUser) return;
        const data = {
            name: document.getElementById('editUserNameInput').value.trim(),
            gender: document.getElementById('editGenderSelect').value,
            phone: document.getElementById('editPhoneInput').value.trim(),
            email: document.getElementById('editEmailInput').value.trim(),
        };
        if(data.name && data.gender !== 'other' && data.phone && data.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            socket.emit('updateSettings', data);
            alert('تم حفظ التغييرات!');
        } else {
            alert('الرجاء ملء جميع الحقول بشكل صحيح.');
        }
    });

    document.getElementById('showConnectBtn').addEventListener('click', () => { if(currentUser) togglePanel('connectPanel'); });
    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCode = document.getElementById('friendCodeInput').value.trim();
        if(friendCode) socket.emit('requestLink', { friendCode });
        document.getElementById('friendCodeInput').value = '';
    });

    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessageFromBottomBar(); });
    
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => { 
        if(currentUser && linkedFriends.length > 0) { 
            togglePanel('chatPanel'); 
            setupChatPanel(); 
        } else { 
            alert('الرجاء ربط صديق أولاً لعرض سجل الدردشة.'); 
        } 
    });

    document.getElementById('showFeaturesBtn').addEventListener('click', () => {
        if (!currentUser) return;
        const selectUserDropdown = document.getElementById('historicalPathUserSelect');
        if (selectUserDropdown) {
            selectUserDropdown.innerHTML = '';
            const selfOption = document.createElement('option');
            selfOption.value = currentUser.userId;
            selfOption.textContent = currentUser.name + " (أنا)";
            selectUserDropdown.appendChild(selfOption);
            linkedFriends.forEach(friend => {
                const option = document.createElement('option');
                option.value = friend.userId;
                option.textContent = friend.name;
                selectUserDropdown.appendChild(option);
            });
        }
        togglePanel('featuresPanel');
        updateFriendBatteryStatus();
        fetchAndDisplayPrayerTimes();
    });

    document.getElementById('viewHistoricalPathBtn').addEventListener('click', () => {
        const selectedUserId = document.getElementById('historicalPathUserSelect').value;
        if (selectedUserId) socket.emit('requestHistoricalPath', { targetUserId: selectedUserId, limit: 200 });
    });
    
    document.getElementById('clearHistoricalPathBtn').addEventListener('click', () => { clearHistoricalPath(); alert('تم مسح المسار.'); });

    const poiCategorySelect = document.getElementById('poiCategorySelect');
    if (poiCategorySelect) {
        ['Rest Area', 'Medical Post', 'Food Station', 'Water', 'Mosque', 'Parking', 'Info', 'Other'].forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            poiCategorySelect.appendChild(option);
        });
    }

    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("موقعك الحالي غير متاح. يرجى تفعيل GPS.");
        }
        const poiName = prompt("أدخل اسم نقطة الاهتمام:");
        if (poiName) {
            const poiDesc = prompt("أدخل وصفاً (اختياري):");
            const poiCategory = document.getElementById('poiCategorySelect').value;
            const iconMap = { 'Rest Area': '<i class="fas fa-bed"></i>', 'Medical Post': '<i class="fas fa-medkit"></i>', 'Food Station': '<i class="fas fa-utensils"></i>', 'Water': '<i class="fas fa-tint"></i>', 'Mosque': '<i class="fas fa-mosque"></i>', 'Parking': '<i class="fas fa-parking"></i>', 'Info': '<i class="fas fa-info-circle"></i>', 'Other': '<i class="fas fa-map-marker-alt"></i>' };
            socket.emit('addCommunityPOI', { name: poiName, description: poiDesc, category: poiCategory, location: currentUser.location.coordinates, icon: iconMap[poiCategory] || iconMap['Other'] });
        }
    });

    document.getElementById('sosButton').addEventListener('click', () => { /* ... (unchanged) ... */ });
    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);

    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const meetingPointName = document.getElementById('meetingPointInput').value.trim();
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            return alert("لا يمكن تحديد نقطة تجمع بدون تحديد موقعك الحالي أولاً.");
        }
        if (meetingPointName) {
            socket.emit('setMeetingPoint', { name: meetingPointName, location: currentUser.location.coordinates });
        } else {
            alert("الرجاء إدخال اسم لنقطة التجمع.");
        }
    });

    document.getElementById('endMeetingPointBtn').addEventListener('click', () => { if (confirm('هل أنت متأكد من إنهاء نقطة التجمع الحالية؟')) socket.emit('clearMeetingPoint'); });
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    document.getElementById('addMoazebBtn').addEventListener('click', () => { /* ... (unchanged) ... */ });
    document.getElementById('searchMoazebBtn').addEventListener('click', () => { /* ... (unchanged) ... */ });
    document.getElementById('showSettingsBtn').addEventListener('click', () => { if(currentUser) togglePanel('settingsPanel'); });

    document.getElementById('shareLocationToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { shareLocation: e.target.checked }); });
    document.getElementById('soundToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { sound: e.target.checked }); });
    document.getElementById('hideBubblesToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { hideBubbles: e.target.checked }); });
    document.getElementById('stealthModeToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { stealthMode: e.target.checked }); });
    document.getElementById('showPhoneToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { showPhone: e.target.checked }); });
    document.getElementById('showEmailToggle').addEventListener('change', (e) => { if (currentUser) socket.emit('updateSettings', { showEmail: e.target.checked }); });
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => { if(currentUser) { const num = document.getElementById('emergencyWhatsappInput').value.trim(); if(num) { socket.emit('updateSettings', { emergencyWhatsapp: num }); alert('تم الحفظ'); } } });

    document.getElementById('mapPitch').addEventListener('input', (e) => map.setPitch(e.target.value));
    document.getElementById('mapBearing').addEventListener('input', (e) => map.setBearing(e.target.value));
});
