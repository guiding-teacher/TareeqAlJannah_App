// script.js

// script.js

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

// ====== متغيرات عامة سيتم ملؤها من الخادم ======
let currentUser = null;
let linkedFriends = [];
const friendMarkers = {}; // لتخزين مركبات الأصدقاء ديناميكياً { userId: mapboxgl.Marker }
const poiMarkers = {}; // لتخزين مركبات نقاط الاهتمام
let currentHistoricalPathLayer = null; // لتتبع طبقة المسار التاريخي المعروضة
let currentChatFriendId = null; // معرف الصديق الذي تتم الدردشة معه حاليا


// المواقع الرئيسية في العراق (من الصورة + إضافات جديدة)
const holySites = [
    // مناطق الجنوب (البصرة، الفاو، الناصرية)
    { name: 'الفاو', coords: [48.4729, 29.9866], icon: '<i class="fas fa-ship"></i>' },
    { name: 'البصرة', coords: [47.8100, 30.5000], icon: '<i class="fas fa-city"></i>' },
    { name: 'حمدان', coords: [47.8800, 30.5500], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'الكزيزة', coords: [47.9500, 30.6000], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'الكرمة', coords: [48.0200, 30.6500], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'الهارثة', coords: [48.0900, 30.7000], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'الدير', coords: [48.1600, 30.7500], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'القرنة', coords: [48.2300, 30.8000], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'المدينة', coords: [48.3000, 30.8500], icon: '<i class="fas fa-map-marker-alt"></i>' }, // جديد
    { name: 'كرمة بني سعيد', coords: [46.0000, 30.5000], icon: '<i class="fas fa-road"></i>' },
    { name: 'ناصرية تقاطع او', coords: [45.9000, 30.6000], icon: '<i class="fas fa-road"></i>' },
    { name: 'طاقة كهرباء', coords: [45.8000, 30.7000], icon: '<i class="fas fa-lightbulb"></i>' },
    { name: 'البطاحة', coords: [45.7000, 30.8000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الهويشلي', coords: [45.6000, 30.9000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الدراجي', coords: [45.5000, 31.0000], icon: '<i class="fas fa-road"></i>' },
    { name: 'المجر', coords: [45.4000, 31.1000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الورقاء', coords: [45.3000, 31.2000], icon: '<i class="fas fa-road"></i>' },
    { name: 'السماوة', coords: [45.2831, 31.3060], icon: '<i class="fas fa-city"></i>' },
    { name: 'الخضر', coords: [45.2000, 31.4000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الرميثة', coords: [45.1000, 31.5000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الطابو', coords: [45.0000, 31.6000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الحمزة', coords: [44.8000, 31.5000], icon: '<i class="fas fa-map-pin"></i>' },
    { name: 'الشافية', coords: [44.9000, 31.7000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الديوانية', coords: [45.1000, 31.9800], icon: '<i class="fas fa-city"></i>' },
    { name: 'السنية', coords: [44.6000, 31.8500], icon: '<i class="fas fa-road"></i>' },
    { name: 'الطلبعة', coords: [44.5500, 31.9000], icon: '<i class="fas fa-road"></i>' },
    { name: 'القاسم', coords: [44.4000, 32.0000], icon: '<i class="fas fa-map-pin"></i>' },
    { name: 'الهاشميات', coords: [44.5000, 32.1000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الجربوعية', coords: [44.4000, 32.2000], icon: '<i class="fas fa-road"></i>' },
    { name: 'المهمازية', coords: [44.3000, 32.4000], icon: '<i class="fas fa-road"></i>' },
    { name: 'الحلة', coords: [44.4079, 32.4820], icon: '<i class="fas fa-city"></i>' },
    { name: 'أبو غرق', coords: [44.2500, 32.5500], icon: '<i class="fas fa-road"></i>' },
    { name: 'أطويريج', coords: [44.1500, 32.6000], icon: '<i class="fas fa-road"></i>' },
    { name: 'كربلاء المقدسة', coords: [44.0329, 32.6163], icon: '<i class="fas fa-mosque"></i>' },
    { name: 'الكوفة', coords: [44.3824, 32.0308], icon: '<i class="fas fa-landmark"></i>' },
    { name: 'النجف الأشرف', coords: [44.3312, 31.9961], icon: '<i class="fas fa-mosque"></i>' }
];

const socket = io('http://localhost:3000');

// ====== وظائف عامة للواجهة الرسومية (UI Helpers) ======

function togglePanel(panelId) {
    document.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    document.querySelectorAll('.main-header nav button').forEach(btn => {
        btn.classList.remove('active');
    });

    const targetPanel = document.getElementById(panelId);
    if (targetPanel) {
        targetPanel.classList.add('active');
        const activeBtn = document.querySelector(`button[id$="${panelId.replace('Panel', 'Btn')}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
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

// ====== وظائف الخريطة والمواقع (Map & Location Functions) ======

function createCustomMarker(user) {
    // تحقق من وجود بيانات الموقع قبل المتابعة (تجنب [0,0] الافتراضية)
    if (!user || !user.location || !user.location.coordinates || (user.location.coordinates[0] === 0 && user.location.coordinates[1] === 0)) {
        console.warn("بيانات الموقع غير صالحة لإنشاء مركر:", user);
        return null;
    }

    if (friendMarkers[user.userId]) {
        friendMarkers[user.userId].remove();
    }

    const el = document.createElement('div');
    el.className = 'mapboxgl-marker';

    if (currentUser && user.userId === currentUser.userId && currentUser.settings.stealthMode) {
        el.classList.add('stealth-mode');
    }

    el.innerHTML = `
        <img class="user-marker-photo" src="${user.photo || 'https://via.placeholder.com/100/CCCCCC/FFFFFF?text=USER'}" alt="${user.name}">
        <div class="user-marker-name">${user.name}</div>
        <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(user.location.coordinates)
        .addTo(map);

    if (user.userId !== currentUser.userId) {
        marker.getElement().addEventListener('click', () => {
            showFriendDetailsPopup(user);
        });
    }

    friendMarkers[user.userId] = marker;
    return marker;
}

function showFriendDetailsPopup(friend) {
    // تحقق أدق من توفر بيانات الموقع الحقيقية لك وللصديق
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
        if (!currentUserHasValidLocation) {
            distanceHtml += '<small>(موقعك غير متاح بعد)</small>';
        } else if (!friendHasValidLocation) {
            distanceHtml += `<small>(موقع ${friend.name} غير متاح بعد)</small>`;
        }
    }
    // تنسيق آخر ظهور
    const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'غير معروف';


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
        document.getElementById(`unfriendBtn-${friend.userId}`).addEventListener('click', () => {
            if (confirm(`هل أنت متأكد أنك تريد إلغاء الارتباط بـ ${friend.name}؟`)) {
                socket.emit('unfriendUser', { friendId: friend.userId });
                popup.remove();
            }
        });
        document.getElementById(`chatFriendBtn-${friend.userId}`).addEventListener('click', () => {
            togglePanel('chatPanel');
            currentChatFriendId = friend.userId; // تعيين الصديق المحدد للدردشة
            if (document.getElementById('chatFriendSelect')) {
                document.getElementById('chatFriendSelect').value = friend.userId;
            }
            const chatMessagesDiv = document.getElementById('chatMessages');
            if (chatMessagesDiv) chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #999;">جاري تحميل الرسائل...</p>';
            socket.emit('requestChatHistory', { friendId: currentChatFriendId });
            popup.remove();
        });
    });
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) {
        console.warn("بيانات نقطة الاهتمام غير مكتملة لإنشاء مركر:", poi);
        return null;
    }

    if (poiMarkers[poi._id]) {
        poiMarkers[poi._id].remove();
    }

    const el = document.createElement('div');
    el.className = 'poi-marker';
    // استخدام الأيقونة القادمة من الخادم أو أيقونة افتراضية
    let iconHtml = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    el.innerHTML = iconHtml;

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


function showGeneralMap() {
    for (const userId in friendMarkers) {
        if (friendMarkers[userId]) friendMarkers[userId].remove();
        if (currentUser && map.getSource(`line-${currentUser.userId}-${userId}`)) {
            map.removeLayer(`line-${currentUser.userId}-${userId}`);
            map.removeSource(`line-${currentUser.userId}-${userId}`);
        }
    }
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath(); // إزالة المسار التاريخي إذا كان معروضا


    holySites.forEach(site => {
        if (!site.marker) {
            const el = document.createElement('div');
            el.className = 'holy-site-marker';
            el.innerHTML = site.icon;
            site.marker = new mapboxgl.Marker(el)
                .setLngLat(site.coords)
                .setPopup(new mapboxgl.Popup().setHTML(`<h3>${site.name}</h3><p>موقع مهم</p>`))
                .addTo(map);
        } else {
            site.marker.addTo(map);
        }
    });

    socket.emit('requestPOIs'); // طلب نقاط الاهتمام لعرضها على الخريطة العامة

    drawGeneralPaths();

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
    if (map.getSource('general-paths')) {
        map.removeLayer('general-paths');
        map.removeSource('general-paths');
    }
    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    clearHistoricalPath(); // إزالة المسار التاريخي إذا كان معروضا


    for (const userId in friendMarkers) {
        if (friendMarkers[userId]) friendMarkers[userId].remove();
        if (currentUser && map.getSource(`line-${currentUser.userId}-${userId}`)) {
            map.removeLayer(`line-${currentUser.userId}-${userId}`);
            map.removeSource(`line-${currentUser.userId}-${userId}`);
        }
    }
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);


    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        createCustomMarker(currentUser);
        map.flyTo({
            center: currentUser.location.coordinates,
            zoom: 12,
            pitch: 45,
            bearing: -17.6
        });
    } else if (currentUser) {
        map.flyTo({
            center: [43.6875, 33.3152],
            zoom: 6,
            pitch: 45,
            bearing: -17.6
        });
    }


    linkedFriends.forEach(friend => {
        if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
        }
    });

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        linkedFriends.forEach(friend => {
            if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
                drawConnectionLine(currentUser.location.coordinates, friend.location.coordinates, `line-${currentUser.userId}-${friend.userId}`);
            }
        });
    }
}


function drawGeneralPaths() {
    const pathCoordinates = [
        holySites.find(s => s.name === 'الفاو')?.coords,
        holySites.find(s => s.name === 'البصرة')?.coords,
        holySites.find(s => s.name === 'حمدان')?.coords,
        holySites.find(s => s.name === 'الكزيزة')?.coords,
        holySites.find(s => s.name === 'الكرمة')?.coords,
        holySites.find(s => s.name === 'الهارثة')?.coords,
        holySites.find(s => s.name === 'الدير')?.coords,
        holySites.find(s => s.name === 'القرنة')?.coords,
        holySites.find(s => s.name === 'المدينة')?.coords,
        holySites.find(s => s.name === 'كرمة بني سعيد')?.coords,
        holySites.find(s => s.name === 'ناصرية تقاطع او')?.coords,
        holySites.find(s => s.name === 'طاقة كهرباء')?.coords,
        holySites.find(s => s.name === 'البطاحة')?.coords,
        holySites.find(s => s.name === 'الهويشلي')?.coords,
        holySites.find(s => s.name === 'الدراجي')?.coords,
        holySites.find(s => s.name === 'المجر')?.coords,
        holySites.find(s => s.name === 'الورقاء')?.coords,
        holySites.find(s => s.name === 'السماوة')?.coords,
        holySites.find(s => s.name === 'الخضر')?.coords,
        holySites.find(s => s.name === 'الرميثة')?.coords,
        holySites.find(s => s.name === 'الطابو')?.coords,
        holySites.find(s => s.name === 'الحمزة')?.coords,
        holySites.find(s => s.name === 'الشافية')?.coords,
        holySites.find(s => s.name === 'الديوانية')?.coords,
        holySites.find(s => s.name === 'السنية')?.coords,
        holySites.find(s => s.name === 'الطلبعة')?.coords,
        holySites.find(s => s.name === 'القاسم')?.coords,
        holySites.find(s => s.name === 'الهاشميات')?.coords,
        holySites.find(s => s.name === 'الجربوعية')?.coords,
        holySites.find(s => s.name === 'المهمازية')?.coords,
        holySites.find(s => s.name === 'الحلة')?.coords,
        holySites.find(s => s.name === 'أبو غرق')?.coords,
        holySites.find(s => s.name === 'أطويريج')?.coords,
        holySites.find(s => s.name === 'كربلاء المقدسة')?.coords,
        holySites.find(s => s.name === 'الكوفة')?.coords,
        holySites.find(s => s.name === 'النجف الأشرف')?.coords
    ].filter(Boolean); // لتصفية أي قيم undefined إذا لم يتم العثور على موقع بالاسم

    const geojson = {
        'type': 'Feature',
        'properties': {},
        'geometry': {
            'type': 'LineString',
            'coordinates': pathCoordinates
        }
    };

    if (map.getSource('general-paths')) {
        map.getSource('general-paths').setData(geojson);
    } else {
        map.addSource('general-paths', {
            'type': 'geojson',
            'data': geojson
        });
        map.addLayer({
            'id': 'general-paths',
            'type': 'line',
            'source': 'general-paths',
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#8A2BE2',
                'line-width': 5,
                'line-opacity': 0.7
            }
        });
    }

    let totalDistance = 0;
    for (let i = 0; i < pathCoordinates.length - 1; i++) {
        totalDistance += calculateDistance(
            pathCoordinates[i][1], pathCoordinates[i][0],
            pathCoordinates[i+1][1], pathCoordinates[i+1][0]
        );
    }
    console.log(`المسافة الإجمالية للمسار العام المقترح: ${totalDistance.toFixed(2)} كم`);
}


function drawConnectionLine(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords) return;

    const geojson = {
        'type': 'Feature',
        'properties': {},
        'geometry': {
            'type': 'LineString',
            'coordinates': [startCoords, endCoords]
        }
    };

    if (map.getSource(layerId)) {
        map.getSource(layerId).setData(geojson);
    } else {
        map.addSource(layerId, {
            'type': 'geojson',
            'data': geojson
        });
        map.addLayer({
            'id': layerId,
            'type': 'line',
            'source': layerId,
            'layout': {
                'line-join': 'round',
                'line-cap': 'round'
            },
            'paint': {
                'line-color': '#007bff',
                'line-width': 4,
                'line-dasharray': [0.5, 2]
            }
        });
    }
}

// دالة لمسح المسار التاريخي المعروض حاليا
function clearHistoricalPath() {
    if (currentHistoricalPathLayer && map.getLayer(currentHistoricalPathLayer)) {
        map.removeLayer(currentHistoricalPathLayer);
        map.removeSource(currentHistoricalPathLayer);
        currentHistoricalPathLayer = null;
    }
}

// دالة لرسم المسار التاريخي
function drawHistoricalPath(userId, pathCoordinates) {
    clearHistoricalPath(); // مسح أي مسار سابق

    if (pathCoordinates.length < 2) {
        console.warn("لا توجد نقاط كافية لرسم المسار التاريخي.");
        return;
    }

    const layerId = `historical-path-${userId}`;
    currentHistoricalPathLayer = layerId; // حفظ ID الطبقة المعروضة

    map.addSource(layerId, {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'properties': {},
            'geometry': {
                'type': 'LineString',
                'coordinates': pathCoordinates
            }
        }
    });

    map.addLayer({
        'id': layerId,
        'type': 'line',
        'source': layerId,
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#FF00FF', // لون بنفسجي مميز للمسار التاريخي
            'line-width': 6,
            'line-opacity': 0.8
        }
    });

    // تحريك الخريطة لتركيز على المسار
    const bounds = new mapboxgl.LngLatBounds();
    pathCoordinates.forEach(coord => bounds.extend(coord));
    map.fitBounds(bounds, { padding: 50 });
}


function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
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
                userId: currentUser.userId,
                location: [longitude, latitude],
                battery: await getBatteryStatus()
            });
        },
        (error) => {
            console.error("خطأ في تحديد الموقع:", error);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

async function getBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const percentage = (battery.level * 100).toFixed(0);
            return percentage + '%';
        } catch (e) {
            console.error("خطأ في جلب حالة البطارية:", e);
            return 'N/A';
        }
    }
    return 'N/A';
}

// وظائف محاكاة الأصوات
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

// دالة إرسال الرسالة
function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const messageText = chatInput.value.trim();
    if (!currentUser) {
        alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
        return;
    }
    if (!currentChatFriendId) { // تأكد أن هناك صديق محدد للدردشة
        alert("الرجاء اختيار صديق للدردشة أولاً.");
        return;
    }
    if (messageText) { // الرسالة يجب ألا تكون فارغة
        addChatMessage(currentUser.name, messageText, 'sent', new Date()); // إضافة new Date() ليكون له timestamp

        socket.emit('chatMessage', {
            senderId: currentUser.userId,
            receiverId: currentChatFriendId, // الآن نرسل إلى الصديق المحدد
            message: messageText
        });

        if (currentUser.settings.sound) {
            playNotificationSound();
        }
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(currentUser.userId, messageText);
        }
        chatInput.value = '';
    } else {
        alert("الرسالة فارغة.");
    }
}

// دالة إضافة الرسالة لواجهة الدردشة
function addChatMessage(senderName, messageText, type = '', timestamp = new Date()) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    // إضافة الوقت واسم المرسل
    const timeString = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `<span class="message-meta">${senderName} - ${timeString}</span><br>${messageText}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// دالة عرض فقاعة الرسالة
function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble) {
        bubble.textContent = messageText;
        bubble.classList.add('show');
        setTimeout(() => {
            bubble.classList.remove('show');
        }, 3000);
    }
}

// دالة تحديث حالة بطارية الأصدقاء في لوحة الميزات
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

// دالة لجلب وعرض أوقات الصلاة (محاكاة)
async function fetchAndDisplayPrayerTimes() {
    const displayElement = document.getElementById('prayerTimesDisplay');
    displayElement.innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';

    const mockPrayerTimes = {
        Fajr: "04:30 ص",
        Dhuhr: "12:30 م",
        Asr: "04:00 م",
        Maghrib: "06:45 م",
        Isha: "08:15 م"
    };

    setTimeout(() => {
        displayElement.innerHTML = `
            <p>الفجر: ${mockPrayerTimes.Fajr}</p>
            <p>الظهر: ${mockPrayerTimes.Dhuhr}</p>
            <p>العصر: ${mockPrayerTimes.Asr}</p>
            <p>المغرب: ${mockPrayerTimes.Maghrib}</p>
            <p>العشاء: ${mockPrayerTimes.Isha}</p>
        `;
    }, 1500);
}

// دالة جديدة لإعداد لوحة الدردشة (لوحة chatPanel)
function setupChatPanel() {
    const chatFriendSelect = document.getElementById('chatFriendSelect');
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatFriendSelect.innerHTML = ''; // مسح الخيارات القديمة

    // إضافة خيار لكل صديق مرتبط
    if (linkedFriends.length > 0) {
        linkedFriends.forEach(friend => {
            const option = document.createElement('option');
            option.value = friend.userId;
            option.textContent = friend.name;
            chatFriendSelect.appendChild(option);
        });
        // تحديد الصديق الأول كصديق افتراضي للدردشة
        currentChatFriendId = linkedFriends[0].userId;
        chatFriendSelect.value = currentChatFriendId;

        // طلب سجل الدردشة مع هذا الصديق
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #999;">جاري تحميل الرسائل...</p>';
        socket.emit('requestChatHistory', { friendId: currentChatFriendId });
    } else {
        currentChatFriendId = null;
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #777;">لا يوجد أصدقاء للدردشة.</p>';
    }

    // إزالة معالج الأحداث القديم قبل إضافة الجديد لتجنب التكرار
    chatFriendSelect.removeEventListener('change', handleChatFriendChange);
    chatFriendSelect.addEventListener('change', handleChatFriendChange);
}

// دالة مساعدة لمعالج حدث تغيير اختيار الصديق في الدردشة
function handleChatFriendChange(e) {
    currentChatFriendId = e.target.value;
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #999;">جاري تحميل الرسائل...</p>';
    socket.emit('requestChatHistory', { friendId: currentChatFriendId });
}

// ====== التعامل مع أحداث WebSocket من الخادم ======

// 0. تسجيل المستخدم عند الاتصال لأول مرة
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const userName = localStorage.getItem('appUserName') || null;
    const userPhoto = localStorage.getItem('appUserPhoto') || null;
    const emergencyWhatsapp = localStorage.getItem('appEmergencyWhatsapp') || null;

    // إرسال emergencyWhatsapp أيضاً عند التسجيل
    socket.emit('registerUser', { userId, name: userName, photo: userPhoto, emergencyWhatsapp: emergencyWhatsapp });
    console.log('تم إرسال طلب تسجيل المستخدم إلى الخادم:', userId);
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('تم استقبال بيانات المستخدم الحالي من الخادم:', currentUser);
    localStorage.setItem('appUserId', currentUser.userId);
    localStorage.setItem('appUserName', currentUser.name);
    localStorage.setItem('appUserPhoto', currentUser.photo);
    localStorage.setItem('appEmergencyWhatsapp', currentUser.settings.emergencyWhatsapp || ''); // حفظ رقم الواتساب

    // تحديث الواجهة ببيانات المستخدم الأولية (هذه العناصر ستكون موجودة الآن بفضل DOMContentLoaded)
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo;
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    document.getElementById('editUserNameInput').value = currentUser.name;
    document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';


    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;

    startLocationTracking();

    if (currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (data.userId === currentUser.userId) {
        currentUser.location = data.location;
        currentUser.battery = data.battery;
        currentUser.batteryStatus = data.battery;
        currentUser.settings = data.settings;
        currentUser.lastSeen = data.lastSeen;
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
        if (userToUpdate) {
            userToUpdate.location = data.location;
            userToUpdate.battery = data.battery;
            userToUpdate.batteryStatus = data.battery;
            userToUpdate.settings = data.settings;
            userToUpdate.lastSeen = data.lastSeen;
        } else {
            userToUpdate = {
                userId: data.userId,
                name: data.name,
                photo: data.photo,
                location: data.location,
                battery: data.battery,
                batteryStatus: data.battery,
                settings: data.settings,
                lastSeen: data.lastSeen
            };
            linkedFriends.push(userToUpdate);
        }
    }

    if (!userToUpdate.settings.shareLocation || userToUpdate.settings.stealthMode) {
        if (friendMarkers[userToUpdate.userId]) {
            friendMarkers[userToUpdate.userId].remove();
            delete friendMarkers[userToUpdate.userId];
        }
    } else {
        if (userToUpdate.location && userToUpdate.location.coordinates) {
             createCustomMarker(userToUpdate);
        }
    }

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        linkedFriends.forEach(friend => {
            if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
                drawConnectionLine(currentUser.location.coordinates, friend.location.coordinates, `line-${currentUser.userId}-${friend.userId}`);
            } else {
                if (map.getSource(`line-${currentUser.userId}-${friend.userId}`)) {
                    map.removeLayer(`line-${currentUser.userId}-${friend.userId}`);
                    map.removeSource(`line-${currentUser.userId}-${friend.userId}`);
                }
            }
        });
    }
});

socket.on('linkStatus', (data) => {
    alert(data.message);
    if (data.success) {
        document.getElementById('connectPanel').classList.remove('active');
        showFriendsMap();
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('showFriendsMapBtn').classList.add('active'); // اجعل زر الأصدقاء نشطاً
    }
});

socket.on('unfriendStatus', (data) => {
    alert(data.message);
    if (data.success) {
        showFriendsMap(); // تحديث الخريطة لإزالة الصديق
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    console.log('تم تحديث قائمة الأصدقاء:', linkedFriends);

    showFriendsMap(); // إعادة رسم الخريطة لإظهار الأصدقاء الجدد

    // إذا كانت لوحة الأصدقاء مفتوحة، قم بتحديث قائمتها
    if (document.getElementById('connectPanel').classList.contains('active')) {
        const friendsListEl = document.getElementById('friendsList');
        friendsListEl.innerHTML = '';
        if (linkedFriends.length > 0) {
            linkedFriends.forEach(friend => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;">
                    <span>${friend.name}</span>
                    <span style="margin-right: auto; font-size: 0.9em; color: #666;">${friend.batteryStatus || 'N/A'}</span>
                    <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}"><i class="fas fa-user-minus"></i></button>
                `;
                friendsListEl.appendChild(li);
            });
            // ربط معالجات الأحداث لأزرار إلغاء الارتباط داخل القائمة
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
    updateFriendBatteryStatus(); // تحديث لوحة البطارية أيضاً
});

socket.on('newChatMessage', (data) => {
    // تحديث لوحة الدردشة فقط إذا كانت هذه الرسالة تخص المحادثة الحالية
    if (currentUser && data.receiverId === currentUser.userId && data.senderId === currentChatFriendId) {
        addChatMessage(data.senderName, data.message, 'received', data.timestamp);
    }
    // عرض فقاعة الرسالة دائماً (إذا لم يكن المستخدم قد قام بإخفائها)
    if (!currentUser.settings.hideBubbles) {
        showMessageBubble(data.senderId, data.message);
    }
    // تشغيل الصوت إذا كانت الأصوات مفعلة
    if (currentUser.settings.sound) {
        playNotificationSound();
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
    showFriendsMap(); // إعادة رسم الخريطة للتأكد من تحديث العرض
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if (data.success) {
        socket.emit('requestPOIs'); // إذا نجحت الإضافة، اطلب تحديث قائمة النقاط
    }
});

socket.on('updatePOIsList', (poisData) => {
    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    poisData.forEach(poi => {
        createPOIMarker(poi);
    });
    console.log('تم تحديث قائمة نقاط الاهتمام:', poisData);
});

// استقبال بيانات المسار التاريخي ورسمها
socket.on('historicalPathData', (data) => {
    if (data.success) {
        if (data.path && data.path.length > 0) {
            const coordinates = data.path.map(loc => loc.location.coordinates);
            drawHistoricalPath(data.userId, coordinates);
            alert(`تم عرض المسار التاريخي لـ ${data.userId}.`);
        } else {
            alert(`لا توجد بيانات مسار تاريخي لـ ${data.userId} في هذا النطاق.`);
        }
    } else {
        alert(`فشل جلب المسار التاريخي: ${data.message}`);
    }
});

// حدث لاستقبال سجل الدردشة
socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (!chatMessagesDiv) return; // تأكد أن العنصر موجود

    chatMessagesDiv.innerHTML = ''; // مسح الرسائل القديمة

    if (data.success && data.history && data.history.length > 0) {
        data.history.forEach(msg => {
            const messageType = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            // جلب اسم المرسل (يمكن أن نمرر الاسم من الخادم لتجنب البحث هنا)
            const senderName = (msg.senderId === currentUser.userId) ? currentUser.name :
                               linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(senderName, msg.message, messageType, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #777;">لا توجد رسائل سابقة في هذه المحادثة.</p>';
    }
});


map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
});

// ====== هذا الجزء يضمن أن عناصر DOM الديناميكية يتم إنشاؤها وربط الأحداث بها بعد تحميل الصفحة ======
document.addEventListener('DOMContentLoaded', () => {

    // 1. إضافة حقول تغيير الاسم في لوحة الملف الشخصي
    const profileInfoDiv = document.getElementById('profilePanel').querySelector('.profile-info');
    if (profileInfoDiv) {
        const userNameInput = document.createElement('input');
        userNameInput.type = 'text';
        userNameInput.id = 'editUserNameInput';
        userNameInput.placeholder = 'اسمك الجديد';
        profileInfoDiv.appendChild(userNameInput);

        const updateNameBtn = document.createElement('button');
        updateNameBtn.innerHTML = '<i class="fas fa-save"></i> حفظ الاسم';
        updateNameBtn.id = 'updateUserNameBtn';
        profileInfoDiv.appendChild(updateNameBtn);

        // ربط معالج الحدث لزر حفظ الاسم
        updateNameBtn.addEventListener('click', () => {
            if (!currentUser) return;
            const newName = document.getElementById('editUserNameInput').value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('appUserName', newName);
                socket.emit('registerUser', {
                    userId: currentUser.userId,
                    name: newName,
                    photo: currentUser.photo
                });
                document.getElementById('userName').textContent = newName;
                alert('تم تحديث الاسم بنجاح!');
            } else {
                alert('الرجاء إدخال اسم جديد وصالح.');
            }
        });
    }


    // 2. إضافة زر "إضافة استراحة" في لوحة الميزات
    const featuresPanel = document.getElementById('featuresPanel');
    if (featuresPanel) {
        // البحث عن قسم نقاط الاهتمام (POI) بشكل أدق
        const poiSectionTitle = featuresPanel.querySelector('.feature-section h3:has(.fa-map-marker-alt)');
        if (poiSectionTitle) {
            const poiContainer = poiSectionTitle.closest('.feature-section');
            if (poiContainer) {
                const addRestAreaBtn = document.createElement('button');
                addRestAreaBtn.innerHTML = '<i class="fas fa-bed"></i> إضافة استراحة';
                addRestAreaBtn.id = 'addRestAreaBtn';
                poiContainer.appendChild(addRestAreaBtn);

                // جديد: حقل لاختيار أيقونة نقطة الاهتمام
                const iconSelectLabel = document.createElement('label');
                iconSelectLabel.textContent = "اختر أيقونة:";
                const iconSelect = document.createElement('select');
                iconSelect.id = 'poiIconSelect';
                // إضافة خيارات الأيقونات
                const icons = [
                    { value: '<i class="fas fa-bed"></i>', text: 'استراحة' },
                    { value: '<i class="fas fa-medkit"></i>', text: 'طبي' },
                    { value: '<i class="fas fa-utensils"></i>', text: 'طعام' },
                    { value: '<i class="fas fa-faucet"></i>', text: 'ماء' },
                    { value: '<i class="fas fa-mosque"></i>', text: 'مسجد' },
                    { value: '<i class="fas fa-parking"></i>', text: 'موقف' },
                    { value: '<i class="fas fa-info-circle"></i>', text: 'أخرى' }
                ];
                icons.forEach(icon => {
                    const option = document.createElement('option');
                    option.value = icon.value;
                    option.innerHTML = icon.text + ' ' + icon.value; // عرض النص والأيقونة
                    iconSelect.appendChild(option);
                });
                poiContainer.appendChild(iconSelectLabel);
                poiContainer.appendChild(iconSelect);


                addRestAreaBtn.addEventListener('click', () => {
                    if (!currentUser || !currentUser.location || !currentUser.location.coordinates) {
                        alert("يرجى تفعيل GPS لتحديد موقع الاستراحة.");
                        return;
                    }
                    const restAreaName = prompt("أدخل اسم الاستراحة:");
                    if (restAreaName) {
                        const restAreaDesc = prompt("أدخل وصفاً للاستراحة (اختياري):");
                        const restAreaCategory = prompt("أدخل فئة الاستراحة (Rest Area, Medical Post, Food Station, Other):", "Rest Area");
                        const selectedIcon = document.getElementById('poiIconSelect').value; // جلب الأيقونة المختارة
                        socket.emit('addCommunityPOI', {
                            name: restAreaName,
                            description: restAreaDesc,
                            category: restAreaCategory,
                            location: currentUser.location.coordinates,
                            icon: selectedIcon // إرسال الأيقونة
                        });
                    }
                });
            }
        }

        // 3. إضافة حقول اختيار المستخدم لـ "تتبع المسار التاريخي"
        const historicalPathSectionTitle = featuresPanel.querySelector('.feature-section h3:has(.fa-route)');
        if (historicalPathSectionTitle) {
            const historicalPathSection = historicalPathSectionTitle.closest('.feature-section');
            if (historicalPathSection) {
                const selectUserLabel = document.createElement('label');
                selectUserLabel.textContent = "اختر المستخدم:";
                const selectUserDropdown = document.createElement('select');
                selectUserDropdown.id = 'historicalPathUserSelect';
                historicalPathSection.appendChild(selectUserLabel);
                historicalPathSection.appendChild(selectUserDropdown);

                const viewPathBtn = document.createElement('button');
                viewPathBtn.innerHTML = '<i class="fas fa-calendar-alt"></i> عرض السجل';
                viewPathBtn.id = 'viewHistoricalPathBtn';
                historicalPathSection.appendChild(viewPathBtn);

                const clearPathBtn = document.createElement('button');
                clearPathBtn.innerHTML = '<i class="fas fa-eraser"></i> مسح المسار';
                clearPathBtn.id = 'clearHistoricalPathBtn';
                historicalPathSection.appendChild(clearPathBtn);


                // تعبئة قائمة المستخدمين عند فتح لوحة الميزات
                // هذا الجزء يعالج بشكل صحيح تعبئة القائمة بناءً على المستخدم الحالي والأصدقاء المرتبطين
                document.getElementById('showFeaturesBtn').addEventListener('click', () => {
                    if (!currentUser) return;
                    selectUserDropdown.innerHTML = ''; // تأكد أن القائمة فارغة قبل التعبئة

                    // أضف المستخدم الحالي كخيار
                    const selfOption = document.createElement('option');
                    selfOption.value = currentUser.userId;
                    selfOption.textContent = currentUser.name + " (أنا)";
                    selectUserDropdown.appendChild(selfOption);

                    // أضف الأصدقاء المرتبطين كخيارات
                    linkedFriends.forEach(friend => {
                        const option = document.createElement('option');
                        option.value = friend.userId;
                        option.textContent = friend.name;
                        selectUserDropdown.appendChild(option);
                    });
                });

                // ربط معالج الحدث لزر "عرض السجل"
                viewPathBtn.addEventListener('click', () => {
                    const selectedUserId = selectUserDropdown.value;
                    if (selectedUserId) {
                        socket.emit('requestHistoricalPath', { targetUserId: selectedUserId, limit: 200 }); // طلب 200 نقطة كحد أقصى
                    } else {
                        alert("الرجاء اختيار مستخدم لعرض مساره.");
                    }
                });

                // ربط معالج الحدث لزر "مسح المسار"
                clearPathBtn.addEventListener('click', () => {
                    clearHistoricalPath();
                    alert('تم مسح المسار التاريخي من الخريطة.');
                });
            }
        }
    }

    // 4. إضافة عنصر اختيار الصديق في لوحة الدردشة (هذا يتم إنشاؤه في الجزء 1 من script.js)
    // الآن، فقط تأكد من ربط معالج الأحداث لزر الدردشة بعد DOMContentLoaded
    document.getElementById('showChatBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        if (linkedFriends.length === 0) {
            alert("الرجاء ربط صديق أولاً لبدء الدردشة.");
            return;
        }
        togglePanel('chatPanel');
        showFriendsMap();
        setupChatPanel(); // استدعاء دالة إعداد لوحة الدردشة الجديدة
    });


    // 5. ربط معالجات الأحداث للأزرار الرئيسية (بعد التأكد من وجودها في DOM)
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => {
        if (linkedFriends.length > 0 && document.getElementById('showFriendsMapBtn') && document.getElementById('showFriendsMapBtn').classList.contains('active')) {
            if (!confirm("هل أنت متأكد أنك تريد مغادرة خريطة الأصدقاء والعودة للخريطة العامة؟")) {
                return;
            }
        }
        togglePanel('generalMapPanelDummy'); // ID وهمي لتفعيل الزر في الهيدر
        showGeneralMap();
    });

    document.getElementById('showFriendsMapBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        togglePanel('friendsMapPanelDummy'); // ID وهمي لتفعيل الزر
        showFriendsMap();
    });

    document.getElementById('showProfileBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        document.getElementById('userName').textContent = currentUser.name;
        document.getElementById('userPhoto').src = currentUser.photo;
        document.getElementById('userLinkCode').textContent = currentUser.linkCode;
        document.getElementById('editUserNameInput').value = currentUser.name;
        togglePanel('profilePanel');
        showFriendsMap();
    });

    document.getElementById('generateCodeBtn').addEventListener('click', () => {
        alert('طلب رمز ربط جديد غير متاح حالياً (هذه ميزة محاكاة - تتطلب الواجهة الخلفية).');
    });

    document.getElementById('showConnectBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        const friendsListEl = document.getElementById('friendsList');
        friendsListEl.innerHTML = '';

        if (linkedFriends.length > 0) {
            linkedFriends.forEach(friend => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;">
                    <span>${friend.name}</span>
                    <span style="margin-right: auto; font-size: 0.9em; color: #666;">${friend.batteryStatus || 'N/A'}</span>
                    <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}"><i class="fas fa-user-minus"></i></button>
                `;
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

        togglePanel('connectPanel');
        showFriendsMap();
    });

    document.getElementById('connectFriendBtn').addEventListener('click', () => {
        const friendCodeInput = document.getElementById('friendCodeInput');
        const friendCode = friendCodeInput ? friendCodeInput.value.trim() : '';
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        if (friendCode) {
            socket.emit('requestLink', { friendCode: friendCode });
            if (friendCodeInput) friendCodeInput.value = '';
        } else {
            alert('الرجاء إدخال رمز الربط.');
        }
    });

    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    document.getElementById('showFeaturesBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        togglePanel('featuresPanel');
        updateFriendBatteryStatus();
        fetchAndDisplayPrayerTimes();
        showFriendsMap();
        socket.emit('requestPOIs');
    });

    document.getElementById('sosButton').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp || emergencyWhatsapp.length < 5) { // تحقق بسيط لطول الرقم
            alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
            return;
        }

        if (confirm("هل أنت متأكد من رغبتك في إرسال إشارة استغاثة (SOS)؟ سيتم إرسال رسالة واتساب إلى رقم الطوارئ الخاص بك وموقعك الجغرافي.")) {
            if (currentUser.settings.sound) {
                playSOSSound();
            }

            // إنشاء رابط واتساب
            let message = "مساعدة عاجلة! أنا بحاجة للمساعدة.\n";
            if (currentUser.location && currentUser.location.coordinates) {
                const lat = currentUser.location.coordinates[1];
                const lng = currentUser.location.coordinates[0];
                message += `موقعي الحالي: https://www.google.com/maps?q=${lat},${lng}\n`;
            } else {
                message += "موقعي غير متاح حالياً.";
            }
            message += `\nمن تطبيق طريق الجنة - ${currentUser.name}`;

            const whatsappUrl = `https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank'); // فتح نافذة واتساب الجديدة

            alert("تم إرسال رسالة SOS عبر واتساب (الرجاء التأكد من إرسال الرسالة من تطبيق واتساب بعد فتحه).");
        }
    });

    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);

    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const meetingPointInput = document.getElementById('meetingPointInput');
        const meetingPointName = meetingPointInput ? meetingPointInput.value.trim() : '';

        if (!currentUser || !currentUser.location || !currentUser.location.coordinates) {
            alert("لا يمكن تحديد نقطة تجمع بدون تحديد موقعك الحالي أولاً.");
            return;
        }
        if (meetingPointName) {
            alert(`تم تحديد نقطة تجمع مؤقتة في موقعك الحالي: ${meetingPointName}. (هذه ميزة محاكاة).`);
            const el = document.createElement('div');
            el.className = 'meeting-point-marker';
            el.innerHTML = `<i class="fas fa-handshake"></i>`;
            new mapboxgl.Marker(el)
                .setLngLat(currentUser.location.coordinates)
                .setPopup(new mapboxgl.Popup().setHTML(`<h3>نقطة التجمع: ${meetingPointName}</h3>`))
                .addTo(map);
        } else {
            alert("الرجاء إدخال اسم لنقطة التجمع.");
        }
    });

    document.getElementById('showSettingsBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        togglePanel('settingsPanel');
        if (document.getElementById('shareLocationToggle')) {
            document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
        }
        if (document.getElementById('soundToggle')) {
            document.getElementById('soundToggle').checked = currentUser.settings.sound;
        }
        if (document.getElementById('hideBubblesToggle')) {
            document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
        }
        if (document.getElementById('stealthModeToggle')) {
            document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;
        }
        if (document.getElementById('emergencyWhatsappInput')) { // تحديث حقل الواتساب عند فتح الإعدادات
            document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';
        }
    });

    document.getElementById('shareLocationToggle').addEventListener('change', (e) => {
        if (!currentUser) return;
        currentUser.settings.shareLocation = e.target.checked;
        socket.emit('updateSettings', { shareLocation: e.target.checked });
        alert(`مشاركة الموقع: ${e.target.checked ? 'مفعّلة' : 'معطلة'}. (تم الإرسال للخادم).`);
    });

    document.getElementById('soundToggle').addEventListener('change', (e) => {
        if (!currentUser) return;
        currentUser.settings.sound = e.target.checked;
        socket.emit('updateSettings', { sound: e.target.checked });
        alert(`الأصوات: ${e.target.checked ? 'مفعّلة' : 'معطلة'}. (تم الإرسال للخادم).`);
    });

    document.getElementById('hideBubblesToggle').addEventListener('change', (e) => {
        if (!currentUser) return;
        currentUser.settings.hideBubbles = e.target.checked;
        socket.emit('updateSettings', { hideBubbles: e.target.checked });
        alert(`فقاعات الرسائل: ${e.target.checked ? 'مخفية' : 'مرئية'}. (تم الإرسال للخادم).`);
    });

    document.getElementById('stealthModeToggle').addEventListener('change', (e) => {
        if (!currentUser) return;
        currentUser.settings.stealthMode = e.target.checked;
        socket.emit('updateSettings', { stealthMode: e.target.checked });
        alert(`وضع التخفي: ${e.target.checked ? 'مفعّل (لن تظهر على الخريطة للآخرين)' : 'معطل (ستظهر على الخريطة)'}. (تم الإرسال للخادم).`);
    });

    // جديد: معالج لزر حفظ رقم الواتساب للطوارئ
    const updateEmergencyWhatsappBtn = document.getElementById('updateEmergencyWhatsappBtn');
    if (updateEmergencyWhatsappBtn) {
        updateEmergencyWhatsappBtn.addEventListener('click', () => {
            if (!currentUser) return;
            const newWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
            if (newWhatsapp !== currentUser.settings.emergencyWhatsapp) {
                currentUser.settings.emergencyWhatsapp = newWhatsapp;
                localStorage.setItem('appEmergencyWhatsapp', newWhatsapp); // حفظ في Local Storage
                socket.emit('updateSettings', { emergencyWhatsapp: newWhatsapp }); // إرسال للخادم
                alert('تم حفظ رقم الواتساب للطوارئ بنجاح!');
            } else {
                alert('الرجاء إدخال رقم واتساب جديد.');
            }
        });
    }

}); // نهاية DOMContentLoaded
// وظائف محاكاة الأصوات
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

// دالة إرسال الرسالة
function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const messageText = chatInput.value.trim();
    if (!currentUser) {
        alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
        return;
    }
    if (messageText && linkedFriends.length > 0) {
        addChatMessage(currentUser.name, messageText, 'sent');

        socket.emit('chatMessage', {
            senderId: currentUser.userId,
            receiverId: linkedFriends[0].userId, // يمكن تعديل هذا لاختيار مستلم معين
            message: messageText
        });

        if (currentUser.settings.sound) {
            playNotificationSound();
        }
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(currentUser.userId, messageText);
        }
        chatInput.value = '';
    } else if (linkedFriends.length === 0) {
        alert("يرجى ربط صديق أولاً لإرسال الرسائل.");
    } else {
        alert("الرسالة فارغة.");
    }
}

// دالة إضافة الرسالة لواجهة الدردشة
function addChatMessage(senderName, messageText, type = '') {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;
    msgDiv.textContent = `${senderName}: ${messageText}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// دالة عرض فقاعة الرسالة
function showMessageBubble(userId, messageText) {
    const bubble = document.getElementById(`msg-bubble-${userId}`);
    if (bubble) {
        bubble.textContent = messageText;
        bubble.classList.add('show');
        setTimeout(() => {
            bubble.classList.remove('show');
        }, 3000);
    }
}

// دالة تحديث حالة بطارية الأصدقاء في لوحة الميزات
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

// دالة لجلب وعرض أوقات الصلاة (محاكاة)
async function fetchAndDisplayPrayerTimes() {
    const displayElement = document.getElementById('prayerTimesDisplay');
    displayElement.innerHTML = '<p>جاري جلب أوقات الصلاة...</p>';

    const mockPrayerTimes = {
        Fajr: "04:30 ص",
        Dhuhr: "12:30 م",
        Asr: "04:00 م",
        Maghrib: "06:45 م",
        Isha: "08:15 م"
    };

    setTimeout(() => {
        displayElement.innerHTML = `
            <p>الفجر: ${mockPrayerTimes.Fajr}</p>
            <p>الظهر: ${mockPrayerTimes.Dhuhr}</p>
            <p>العصر: ${mockPrayerTimes.Asr}</p>
            <p>المغرب: ${mockPrayerTimes.Maghrib}</p>
            <p>العشاء: ${mockPrayerTimes.Isha}</p>
        `;
    }, 1500);
}


// ====== التعامل مع أحداث WebSocket من الخادم ======

// 0. تسجيل المستخدم عند الاتصال لأول مرة
socket.on('connect', () => {
    let userId = localStorage.getItem('appUserId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('appUserId', userId);
    }
    const userName = localStorage.getItem('appUserName') || null;
    const userPhoto = localStorage.getItem('appUserPhoto') || null;

    socket.emit('registerUser', { userId, name: userName, photo: userPhoto });
    console.log('تم إرسال طلب تسجيل المستخدم إلى الخادم:', userId);
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    console.log('تم استقبال بيانات المستخدم الحالي من الخادم:', currentUser);
    localStorage.setItem('appUserId', currentUser.userId);
    localStorage.setItem('appUserName', currentUser.name);
    localStorage.setItem('appUserPhoto', currentUser.photo);

    // تحديث الواجهة ببيانات المستخدم الأولية (هذه العناصر ستكون موجودة الآن)
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userPhoto').src = currentUser.photo;
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    document.getElementById('editUserNameInput').value = currentUser.name; // هذا العنصر يتم إضافته برمجياً

    document.getElementById('shareLocationToggle').checked = currentUser.settings.shareLocation;
    document.getElementById('soundToggle').checked = currentUser.settings.sound;
    document.getElementById('hideBubblesToggle').checked = currentUser.settings.hideBubbles;
    document.getElementById('stealthModeToggle').checked = currentUser.settings.stealthMode;

    startLocationTracking();

    if (currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
});

socket.on('locationUpdate', (data) => {
    let userToUpdate;
    if (data.userId === currentUser.userId) {
        currentUser.location = data.location;
        currentUser.battery = data.battery;
        currentUser.batteryStatus = data.battery; // للتوافق
        currentUser.settings = data.settings;
        currentUser.lastSeen = data.lastSeen;
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
        if (userToUpdate) {
            userToUpdate.location = data.location;
            userToUpdate.battery = data.battery;
            userToUpdate.batteryStatus = data.battery; // للتوافق
            userToUpdate.settings = data.settings;
            userToUpdate.lastSeen = data.lastSeen;
        } else {
            // هذا السيناريو قد يحدث إذا تم الربط للتو ولم يتم تحديث linkedFriends بعد
            userToUpdate = {
                userId: data.userId,
                name: data.name,
                photo: data.photo,
                location: data.location,
                battery: data.battery,
                batteryStatus: data.battery,
                settings: data.settings,
                lastSeen: data.lastSeen
            };
            linkedFriends.push(userToUpdate);
        }
    }

    if (!userToUpdate.settings.shareLocation || userToUpdate.settings.stealthMode) {
        if (friendMarkers[userToUpdate.userId]) {
            friendMarkers[userToUpdate.userId].remove();
            delete friendMarkers[userToUpdate.userId];
        }
    } else {
        if (userToUpdate.location && userToUpdate.location.coordinates) {
             createCustomMarker(userToUpdate);
        }
    }

    if (currentUser && currentUser.location && currentUser.location.coordinates && !currentUser.settings.stealthMode && currentUser.settings.shareLocation) {
        linkedFriends.forEach(friend => {
            if (friend.location && friend.location.coordinates && friend.settings && friend.settings.shareLocation && !friend.settings.stealthMode) {
                drawConnectionLine(currentUser.location.coordinates, friend.location.coordinates, `line-${currentUser.userId}-${friend.userId}`);
            } else {
                if (map.getSource(`line-${currentUser.userId}-${friend.userId}`)) {
                    map.removeLayer(`line-${currentUser.userId}-${friend.userId}`);
                    map.removeSource(`line-${currentUser.userId}-${friend.userId}`);
                }
            }
        });
    }
});

socket.on('linkStatus', (data) => {
    alert(data.message);
    if (data.success) {
        document.getElementById('connectPanel').classList.remove('active');
        showFriendsMap();
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('showFriendsMapBtn').classList.add('active'); // اجعل زر الأصدقاء نشطاً
    }
});

socket.on('unfriendStatus', (data) => {
    alert(data.message);
    if (data.success) {
        // 'updateFriendsList' سيعالج التحديثات
        showFriendsMap(); // تحديث الخريطة لإزالة الصديق
    }
});

socket.on('updateFriendsList', (friendsData) => {
    linkedFriends = friendsData;
    console.log('تم تحديث قائمة الأصدقاء:', linkedFriends);

    showFriendsMap(); // إعادة رسم الخريطة لإظهار الأصدقاء الجدد

    // إذا كانت لوحة الأصدقاء مفتوحة، قم بتحديث قائمتها
    if (document.getElementById('connectPanel').classList.contains('active')) {
        const friendsListEl = document.getElementById('friendsList');
        friendsListEl.innerHTML = '';
        if (linkedFriends.length > 0) {
            linkedFriends.forEach(friend => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <img src="${friend.photo}" style="width:30px; height:30px; border-radius:50%;">
                    <span>${friend.name}</span>
                    <span style="margin-right: auto; font-size: 0.9em; color: #666;">${friend.batteryStatus || 'N/A'}</span>
                    <button class="unfriend-in-list-btn" data-friend-id="${friend.userId}"><i class="fas fa-user-minus"></i></button>
                `;
                friendsListEl.appendChild(li);
            });
            // ربط معالجات الأحداث لأزرار إلغاء الارتباط داخل القائمة
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
    updateFriendBatteryStatus(); // تحديث لوحة البطارية أيضاً
});

socket.on('newChatMessage', (data) => {
    if (currentUser && data.receiverId === currentUser.userId) {
        addChatMessage(data.senderName, data.message, 'received');
        if (currentUser.settings.sound) {
            playNotificationSound();
        }
        if (!currentUser.settings.hideBubbles) {
            showMessageBubble(data.senderId, data.message);
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
    showFriendsMap(); // إعادة رسم الخريطة للتأكد من تحديث العرض
});

socket.on('poiStatus', (data) => {
    alert(data.message);
    if (data.success) {
        socket.emit('requestPOIs');
    }
});

socket.on('updatePOIsList', (poisData) => {
    for (const poiId in poiMarkers) {
        if (poiMarkers[poiId]) poiMarkers[poiId].remove();
    }
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    poisData.forEach(poi => {
        createPOIMarker(poi);
    });
    console.log('تم تحديث قائمة نقاط الاهتمام:', poisData);
});

// استقبال بيانات المسار التاريخي ورسمها
socket.on('historicalPathData', (data) => {
    if (data.success) {
        if (data.path && data.path.length > 0) {
            const coordinates = data.path.map(loc => loc.location.coordinates);
            drawHistoricalPath(data.userId, coordinates);
            alert(`تم عرض المسار التاريخي لـ ${data.userId}.`);
        } else {
            alert(`لا توجد بيانات مسار تاريخي لـ ${data.userId} في هذا النطاق.`);
        }
    } else {
        alert(`فشل جلب المسار التاريخي: ${data.message}`);
    }
});


map.on('load', () => {
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
});