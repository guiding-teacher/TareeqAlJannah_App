// تهيئة Mapbox
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
    bearing: -17.6,
    preserveDrawingBuffer: true, // للسماح بالتقاط الصور
    locale: {
        'AttributionControl.ToggleAttribution': 'تبديل الإسناد',
        'AttributionControl.MapFeedback': 'ملاحظات الخريطة',
        'FullscreenControl.Enter': 'عرض ملء الشاشة',
        'FullscreenControl.Exit': 'الخروج من ملء الشاشة',
        'NavigationControl.ResetBearing': 'إعادة توجيه الشمال',
        'NavigationControl.ZoomIn': 'تكبير',
        'NavigationControl.ZoomOut': 'تصغير'
    }
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
let proximityAlertPlayed = false;
let prayerAlertPlayed = false;
let lastPrayerTime = '';
let searchResultMarker = null;

// متغيرات التوجيه
let currentRouteLayerId = null;
let startPointMarker = null;
let endPointMarker = null;
let routeStartCoords = null;
let routeEndCoords = null;
let isNavigating = false;
let navigationSteps = [];
let currentStepIndex = 0;
let refreshFriendsMapBtn = null;
let femaleArabicVoice = null;
let refocusRouteBtn = null; // زر إعادة تركيز الرحلة
let activeRouteBounds = null; // لتخزين حدود الرحلة

// اتصال Socket.IO
const socket = io('https://tareeqaljannah-app.onrender.com');


// ================== نظام التوجيه الصوتي المحسن ==================
function getFemaleArabicVoice() {
    if (femaleArabicVoice) return Promise.resolve(femaleArabicVoice);
    
    return new Promise((resolve) => {
        const setVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                femaleArabicVoice = voices.find(voice => voice.lang.startsWith('ar-') && voice.name.toLowerCase().includes('female')) 
                                 || voices.find(voice => voice.lang.startsWith('ar-'));
                resolve(femaleArabicVoice);
            }
        };

        setVoice(); // Attempt to set it immediately
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = setVoice;
        }
    });
}

// تحميل الأصوات مسبقاً
getFemaleArabicVoice();

function speak(text) {
    if (!currentUser || !currentUser.settings.sound || !('speechSynthesis' in window)) {
        console.log("Voice guidance disabled or not supported.");
        return;
    }

    // إيقاف أي كلام حالي
    window.speechSynthesis.cancel();

    getFemaleArabicVoice().then(voice => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ar-SA';
        
        if (voice) {
            utterance.voice = voice;
        }
        
        utterance.rate = 0.9;
        utterance.pitch = 1.1;
        utterance.volume = 1;

        // معالجة الأخطاء
        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event.error);
        };

        window.speechSynthesis.speak(utterance);
    });
}


// وظائف عامة للواجهة الرسومية
function togglePanel(panelId) {
    map.off('click', closeAllPanels);
    document.body.removeEventListener('click', closeAllPanelsOnClickOutside);

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
            setTimeout(() => {
                map.on('click', closeAllPanels);
                document.body.addEventListener('click', closeAllPanelsOnClickOutside);
            }, 100);
        }
    } else {
         document.getElementById('showGeneralMapBtn').classList.add('active');
    }
}

function closeAllPanels() {
    togglePanel(null);
    document.getElementById('showGeneralMapBtn').classList.add('active');
}

function closeAllPanelsOnClickOutside(e) {
    const activePanel = document.querySelector('.overlay-panel.active');
    const headerButton = e.target.closest('.main-header nav button');
    if (activePanel && !activePanel.contains(e.target) && !headerButton) {
        closeAllPanels();
    }
}

document.querySelectorAll('.close-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        const panel = e.target.closest('.overlay-panel');
        if (panel) {
            panel.classList.remove('active');
        }
        document.querySelectorAll('.main-header nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById('showGeneralMapBtn').classList.add('active');
        map.off('click', closeAllPanels);
        document.body.removeEventListener('click', closeAllPanelsOnClickOutside);
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

    const userPhotoSrc = user.photo && user.photo !== '' ?
        (user.photo.startsWith('http') ? user.photo : `/${user.photo}`) :
        'image/husseini_avatar.png';
    el.innerHTML = `
    <img class="user-marker-photo" src="${userPhotoSrc}" alt="${user.name}" 
         onerror="this.src='image/husseini_avatar.png'">
    <div class="user-marker-name">${user.name}</div>
    <div class="message-bubble" id="msg-bubble-${user.userId}"></div>
`;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(user.location.coordinates)
        .addTo(map);

    if (currentUser && user.userId !== currentUser.userId) {
        marker.getElement().addEventListener('click', (e) => {
            e.stopPropagation();
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
        const distance = (calculateDistance(
            currentUser.location.coordinates[1], currentUser.location.coordinates[0],
            friend.location.coordinates[1], friend.location.coordinates[0]
        ) / 1000).toFixed(2);
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
        <h3>
            ${friend.name}
            <i class="fas fa-question-circle coord-display-icon" data-coords="${friend.location.coordinates.join(',')}" title="عرض الإحداثيات"></i>
        </h3>
        <p><i class="fas fa-battery-full"></i> البطارية: ${friend.batteryStatus || 'N/A'}</p>
        ${distanceHtml}
        <p><i class="fas fa-clock"></i> آخر ظهور: ${lastSeenTime}</p>
        ${friendDetailsHtml}
        <div style="display: flex; justify-content: space-around; margin-top: 10px;">
            <button id="unfriendBtn-${friend.userId}" class="popup-btn unfriend-btn" title="إلغاء الربط"><i class="fas fa-user-minus"></i></button>
            <button id="chatFriendBtn-${friend.userId}" class="popup-btn chat-friend-btn" title="دردشة"><i class="fas fa-comments"></i></button>
            <button id="reconnectPopupBtn-${friend.userId}" class="popup-btn reconnect-friend-btn" title="إعادة رسم المسار"><i class="fas fa-route"></i></button>
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
        document.getElementById(`reconnectPopupBtn-${friend.userId}`).addEventListener('click', () => {
             if (currentUser?.location?.coordinates && friend.location?.coordinates) {
                 drawRoadRouteBetweenPoints(currentUser.location.coordinates, friend.location.coordinates, `route-${currentUser.userId}-${friend.userId}`);
                 popup.remove();
                 map.flyTo({center: friend.location.coordinates, zoom: 14});
            } else {
                 alert('لا يمكن رسم المسار. تأكد من توفر موقعك وموقع صديقك.');
            }
        });
        document.querySelector(`.coord-display-icon[data-coords="${friend.location.coordinates.join(',')}"]`).addEventListener('click', (e) => {
            const coords = e.target.dataset.coords.split(',');
            alert(`إحداثيات ${friend.name}:\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`);
        });
    });
}

// ========== وظائف التوجيه والبحث (تم الاستبدال من الكود النصي) ==========

// 1. البحث العالمي عبر Geocoding API
async function searchPlaces(query) {
    if (!query || query.length < 2) return [];
    try {
        const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${mapboxgl.accessToken}&` +
            `language=ar&` +
            `country=iq&` +
            `limit=10`
        );
        const data = await response.json();
        return data.features || [];
    } catch (error) {
        console.error('خطأ في البحث العالمي:', error);
        return [];
    }
}

// 2. البحث المحلي في الميزات الظاهرة على الخريطة - نسخة محسنة
// 2. البحث المحلي في الميزات الظاهرة على الخريطة - نسخة محسنة
function searchVisibleFeatures(query) {
    if (!map.isStyleLoaded() || !query) return [];
    
    const allFeatures = [];
    
    // جلب جميع الطبقات المرئية
    const layerIds = map.getStyle().layers.map(layer => layer.id);
    
    layerIds.forEach(layerId => {
        try {
            const features = map.queryRenderedFeatures({ layers: [layerId] });
            allFeatures.push(...features);
        } catch (e) {
            // تجاهل الطبقات التي لا يمكن الاستعلام عنها
        }
    });
    
    const matchingFeatures = [];
    // ==> بداية التعديل هنا: سنستخدم مفتاحاً فريداً بدلاً من الاسم فقط
    const foundKeys = new Set(); 

    for (const feature of allFeatures) {
        // البحث في جميع خصائص النص المحتملة
        const possibleNameFields = [
            'name_ar', 'name_ar_rm', 'name', 'name_en', 
            'name_ar_1', 'name_1', 'text_ar', 'text', 'text_en',
            'place_name_ar', 'place_name', 'address', 'street',
            'locality', 'region', 'neighborhood', 'district'
        ];
        
        let featureName = '';
        
        for (const field of possibleNameFields) {
            if (feature.properties[field] && 
                typeof feature.properties[field] === 'string' && 
                feature.properties[field].toLowerCase().includes(query.toLowerCase())) {
                featureName = feature.properties[field];
                break;
            }
        }
        
        if (featureName) {
            let coordinates = [];
            if (feature.geometry.type === 'Point') {
                coordinates = feature.geometry.coordinates;
            } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon') {
                const extent = mapboxgl.LngLatBounds.fromLngLat(feature.geometry.coordinates.flat());
                coordinates = extent.getCenter().toArray();
            }

            // إنشاء مفتاح فريد يجمع بين الاسم والإحداثيات لمنع التكرار الحرفي فقط
            const uniqueKey = `${featureName}_${coordinates.join(',')}`;

            if (coordinates.length === 2 && !foundKeys.has(uniqueKey)) {
                foundKeys.add(uniqueKey); // إضافة المفتاح الفريد إلى المجموعة
                matchingFeatures.push({
                    place_name_ar: featureName,
                    place_name: featureName,
                    center: coordinates,
                    place_type: [feature.layer['source-layer'] || feature.layer.id || 'on-map-feature'],
                    text_ar: featureName,
                    context: [],
                    source: 'map-feature'
                });
            }
        }
    }
    
    return matchingFeatures;
}

// دالة مساعدة لترجمة أنواع الأماكن
function translateFeatureType(type) {
    const translations = {
        'country': 'دولة', 'region': 'محافظة', 'postcode': 'رمز بريدي',
        'district': 'قضاء', 'place': 'مدينة/بلدة', 'locality': 'منطقة',
        'neighborhood': 'حي', 'address': 'عنوان/شارع', 'poi': 'نقطة اهتمام',
        'poi_label': 'نقطة اهتمام', 'road_label': 'شارع', 'water_label': 'مسطح مائي',
        'on-map-feature': 'تسمية على الخريطة'
    };
    const mainType = Array.isArray(type) ? type[0] : type;
    return translations[mainType] || mainType;
}

// 3. عرض النتائج المدمجة - نسخة محسنة
function displaySearchResults(results, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (results.length === 0) {
        container.style.display = 'none';
        return;
    }

    // ترتيب النتائج: النتائج المحلية أولاً ثم العالمية
    const sortedResults = [...results].sort((a, b) => {
        if (a.source === 'map-feature' && b.source !== 'map-feature') return -1;
        if (b.source === 'map-feature' && a.source !== 'map-feature') return 1;
        return 0;
    });

    sortedResults.forEach(feature => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        
        const icon = feature.source === 'map-feature' ? 
            '<i class="fas fa-draw-polygon"></i>' : 
            '<i class="fas fa-map-marker-alt"></i>';
            
        div.innerHTML = `
            ${icon}
            <div>
                <strong>${feature.place_name_ar || feature.place_name}</strong>
                <small style="color: var(--accent-color); font-weight: bold;">${translateFeatureType(feature.place_type)}</small>
                ${feature.source === 'map-feature' ? '<small style="color: #888; margin-right: 5px;">(على الخريطة)</small>' : ''}
            </div>
        `;

        div.addEventListener('click', () => {
            const coords = feature.center;
            const placeName = feature.place_name_ar || feature.place_name;

            if (containerId === 'searchResults') {
                // تكبير أكثر للميزات المحلية
                const zoomLevel = feature.source === 'map-feature' ? 17 : 16;
                map.flyTo({ center: coords, zoom: zoomLevel });
                container.style.display = 'none';
                document.getElementById('mapSearchInput').value = placeName;
            } else if (containerId === 'endPointSuggestions') {
                routeEndCoords = coords;
                document.getElementById('endPointInput').value = placeName;
                container.style.display = 'none';
                if (endPointMarker) endPointMarker.remove();
                endPointMarker = new mapboxgl.Marker({ color: '#FF0000' }).setLngLat(coords).addTo(map);
            }
        });
        container.appendChild(div);
    });

    container.style.display = 'block';
}

// حساب المسار
async function calculateRoute(start, end) {
    if (!start || !end) {
        alert('الرجاء تحديد نقطة البداية والوصول');
        return;
    }
    try {
        const response = await fetch(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${start.join(',')};${end.join(',')}?` +
            `geometries=geojson&language=ar&overview=full&steps=true&access_token=${mapboxgl.accessToken}`
        );
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const routeGeometry = route.geometry;
            const distance = (route.distance / 1000).toFixed(2);
            const duration = (route.duration / 60).toFixed(0);
            
            clearRoute(); // مسح أي رحلة سابقة

            currentRouteLayerId = 'route-' + Date.now();
            map.addSource(currentRouteLayerId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: routeGeometry } });
            map.addLayer({ id: currentRouteLayerId, type: 'line', source: currentRouteLayerId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#007bff', 'line-width': 8, 'line-opacity': 0.8 } });
            
            if (!startPointMarker) startPointMarker = new mapboxgl.Marker({ color: '#00FF00' }).setLngLat(start).setPopup(new mapboxgl.Popup().setHTML('<h4>نقطة البداية</h4>')).addTo(map);
            if (!endPointMarker) endPointMarker = new mapboxgl.Marker({ color: '#FF0000' }).setLngLat(end).setPopup(new mapboxgl.Popup().setHTML('<h4>نقطة الوصول</h4>')).addTo(map);
            
            document.getElementById('routeInfo').style.display = 'block';
            document.getElementById('routeDistance').textContent = `${distance} كم`;
            document.getElementById('routeDuration').textContent = `${duration} دقيقة`;
            
            const routeInfoBar = document.getElementById('route-info-bar');
            routeInfoBar.innerHTML = `<span><i class="fas fa-route"></i> ${distance} كم</span><span><i class="fas fa-clock"></i> ${duration} دقيقة</span>`;
            routeInfoBar.classList.add('active');
            
            const bounds = new mapboxgl.LngLatBounds();
            routeGeometry.coordinates.forEach(coord => bounds.extend(coord));
            activeRouteBounds = bounds; // تخزين حدود الرحلة
            map.fitBounds(bounds, { padding: 80 });

            isNavigating = true;
            navigationSteps = route.legs[0].steps;
            currentStepIndex = 0;
            
            if (refocusRouteBtn) refocusRouteBtn.style.display = 'flex'; // إظهار زر الرحلة
            
            speak(`بدأنا الرحلة. المسافة ${distance} كيلومتر. الوقت المقدر ${duration} دقيقة. اتبع الإرشادات.`);

        } else {
            alert('لم يتم العثور على مسار');
        }
    } catch (error) {
        console.error('خطأ في حساب المسار:', error);
        alert('حدث خطأ أثناء حساب المسار');
    }
}

function clearRoute() {
    if (currentRouteLayerId && map.getLayer(currentRouteLayerId)) {
        map.removeLayer(currentRouteLayerId);
        map.removeSource(currentRouteLayerId);
        currentRouteLayerId = null;
    }
    if (startPointMarker) { startPointMarker.remove(); startPointMarker = null; }
    if (endPointMarker) { endPointMarker.remove(); endPointMarker = null; }
    
    routeStartCoords = null;
    routeEndCoords = null;
    document.getElementById('routeInfo').style.display = 'none';
    document.getElementById('startPointInput').value = '';
    document.getElementById('endPointInput').value = '';
    document.getElementById('route-info-bar').classList.remove('active');

    isNavigating = false;
    navigationSteps = [];
    currentStepIndex = 0;
    activeRouteBounds = null; // مسح حدود الرحلة
    if (refocusRouteBtn) refocusRouteBtn.style.display = 'none'; // إخفاء زر الرحلة
    
    if (window.speechSynthesis.speaking) {
      speak("تم إنهاء الرحلة.");
    } else {
      window.speechSynthesis.cancel();
    }
}

function createPOIMarker(poi) {
    if (!poi || !poi.location || !poi.location.coordinates) return null;
    if (poiMarkers[poi._id]) poiMarkers[poi._id].remove();

    const el = document.createElement('div');
    el.className = 'poi-marker';
    el.innerHTML = poi.icon || '<i class="fas fa-map-marker-alt"></i>';

    const popupHTML = `<h3>${poi.name} <i class="fas fa-question-circle coord-display-icon" data-coords="${poi.location.coordinates.join(',')}" title="عرض الإحداثيات"></i></h3><p>${poi.description || 'لا يوجد وصف'}</p><p><strong>الفئة:</strong> ${poi.category}</p>${currentUser && poi.createdBy === currentUser.userId ? `<button class="delete-poi-btn" data-poi-id="${poi._id}"><i class="fas fa-trash"></i> حذف</button>` : ''}`;
    const marker = new mapboxgl.Marker(el).setLngLat(poi.location.coordinates).setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(popupHTML)).addTo(map);

    marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        setTimeout(() => {
            const deleteBtn = document.querySelector(`.delete-poi-btn[data-poi-id="${poi._id}"]`);
            if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`هل أنت متأكد من حذف "${poi.name}"؟`)) socket.emit('deletePOI', { poiId: poi._id }); });
            const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${poi.location.coordinates.join(',')}"]`);
            if (coordIcon) coordIcon.addEventListener('click', (e) => { e.stopPropagation(); const coords = e.target.dataset.coords.split(','); alert(`إحداثيات "${poi.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`); });
        }, 100);
    });

    poiMarkers[poi._id] = marker;
    return marker;
}

function createMeetingPointMarker(data) {
    const { creatorId, creatorName, point } = data;
    if (!point || !point.location || !point.location.coordinates) return;
    if (meetingPointMarkers[creatorId]) meetingPointMarkers[creatorId].remove();

    const el = document.createElement('div');
    el.className = 'meeting-point-marker';
    el.innerHTML = `<i class="fas fa-handshake"></i>`;

    const popupHTML = `<h3>نقطة تجمع: ${point.name} <i class="fas fa-question-circle coord-display-icon" data-coords="${point.location.coordinates.join(',')}" title="عرض الإحداثيات"></i></h3><p>أنشأها: ${creatorName}</p>${point.expiresAt ? `<p><i class="fas fa-clock"></i> تنتهي في: ${new Date(point.expiresAt).toLocaleString()}</p>` : ''}`;
    const marker = new mapboxgl.Marker(el).setLngLat(point.location.coordinates).setPopup(new mapboxgl.Popup({ offset: 40 }).setHTML(popupHTML)).addTo(map);

    marker.getPopup().on('open', () => {
        const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${point.location.coordinates.join(',')}"]`);
        if (coordIcon) coordIcon.addEventListener('click', (e) => { e.stopPropagation(); const coords = e.target.dataset.coords.split(','); alert(`إحداثيات "${point.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`); });
    });

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
    switch (moazeb.type) { 
        case 'mawkib': iconClass = 'fas fa-flag'; break; 
        case 'hussainiya': iconClass = 'fas fa-place-of-worship'; break; 
        case 'tent': iconClass = 'fas fa-campground'; break; 
        case 'station': iconClass = 'fas fa-gas-pump'; break; 
        case 'sleep': iconClass = 'fas fa-bed'; break; 
        case 'food': iconClass = 'fas fa-utensils'; break; 
        default: iconClass = 'fas fa-home'; 
    }
    el.innerHTML = `<div class="moazeb-icon-container"><i class="${iconClass}"></i></div>`;
    el.style.backgroundColor = '#006400'; 
    el.style.color = 'white'; 
    el.style.borderRadius = '50%'; 
    el.style.width = '30px'; 
    el.style.height = '30px'; 
    el.style.display = 'flex'; 
    el.style.alignItems = 'center'; 
    el.style.justifyContent = 'center'; 
    el.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';

    const isLinkedToThisMoazeb = currentUser && currentUser.linkedMoazeb && currentUser.linkedMoazeb.moazebId._id === moazeb._id;
    const unlinkButtonHTML = isLinkedToThisMoazeb ? `<button class="unlink-from-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-unlink"></i> إلغاء الربط</button>` : '';

    const popupHTML = `
        <h3>${moazeb.name} <i class="fas fa-question-circle coord-display-icon" data-coords="${moazeb.location.coordinates.join(',')}" title="عرض الإحداثيات"></i></h3>
        <p><i class="fas fa-phone"></i> ${moazeb.phone}</p>
        <p><i class="fas fa-map-marker-alt"></i> ${moazeb.address}</p>
        <p><i class="fas fa-city"></i> ${moazeb.governorate} - ${moazeb.district}</p>
        <div class="popup-button-container">
            <button class="link-to-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-link"></i> ربط</button>
            ${unlinkButtonHTML}
            <button class="locate-moazeb-btn" data-moazeb-id="${moazeb._id}"><i class="fas fa-map-marker-alt"></i> تحديد</button>
        </div>
    `;

    // ==> بداية التعديل هنا
    const popup = new mapboxgl.Popup({ offset: 30 }).setHTML(popupHTML);

    const marker = new mapboxgl.Marker(el)
        .setLngLat(moazeb.location.coordinates)
        .setPopup(popup) // ربط النافذة بالماركر
        .addTo(map);

    // استخدام حدث 'open' الخاص بالنافذة المنبثقة لربط أحداث الأزرار
    popup.on('open', () => {
        // نستخدم setTimeout لضمان أن محتوى النافذة قد تم عرضه في DOM
        setTimeout(() => {
            const linkBtn = document.querySelector(`.link-to-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (linkBtn) linkBtn.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                if (confirm(`هل تريد الربط مع المضيف ${moazeb.name}؟`)) 
                    socket.emit('linkToMoazeb', { moazebId: moazeb._id });
                popup.remove();
            });

            const unlinkBtn = document.querySelector(`.unlink-from-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (unlinkBtn) unlinkBtn.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                if (confirm(`هل تريد إلغاء الربط مع المضيف ${moazeb.name}؟`)) 
                    socket.emit('unlinkFromMoazeb');
                popup.remove();
            });

            const locateBtn = document.querySelector(`.locate-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (locateBtn) locateBtn.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                map.flyTo({ center: moazeb.location.coordinates, zoom: 15 });
                popup.remove();
            });

            const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${moazeb.location.coordinates.join(',')}"]`);
            if (coordIcon) coordIcon.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                const coords = e.target.dataset.coords.split(','); 
                alert(`إحداثيات "${moazeb.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`); 
            });
        }, 100);
    });
    // <== نهاية التعديل هنا

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
    map.addSource(moazebConnectionLayerId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: connectionLine } } });
    map.addLayer({ id: moazebConnectionLayerId, type: 'line', source: moazebConnectionLayerId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFA500', 'line-width': 4, 'line-dasharray': [2, 2] } });
}

function clearAllMapLayers() {
    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);
    
    Object.values(moazebMarkers).forEach(marker => marker.remove());
    Object.keys(moazebMarkers).forEach(key => delete moazebMarkers[key]);
    
    Object.values(meetingPointMarkers).forEach(marker => marker.remove());
    Object.keys(meetingPointMarkers).forEach(key => delete meetingPointMarkers[key]);

    clearHistoricalPath();
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
        moazebConnectionLayerId = null;
    }

    const style = map.getStyle();
    if (style && style.layers) {
        style.layers.forEach(layer => {
            if (layer.id.startsWith('route-') && map.getLayer(layer.id)) {
                map.removeLayer(layer.id);
                if(map.getSource(layer.id)) map.removeSource(layer.id);
            }
        });
    }
}

function showGeneralMap() {
    clearRoute();
    clearAllMapLayers();
    if (currentUser) createCustomMarker(currentUser);
    socket.emit('requestPOIs');
    map.flyTo({ center: [43.6875, 33.3152], zoom: 6 });
    if(refreshFriendsMapBtn) refreshFriendsMapBtn.style.display = 'none';
}

async function showFriendsMap() {
    clearRoute();
    clearAllMapLayers();
    const bounds = new mapboxgl.LngLatBounds();
    let hasVisibleUsers = false;

    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        createCustomMarker(currentUser);
        bounds.extend(currentUser.location.coordinates);
        hasVisibleUsers = true;
    }

    linkedFriends.forEach(friend => {
        if (friend?.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
            bounds.extend(friend.location.coordinates);
            hasVisibleUsers = true;
        }
    });

    // رسم خطوط المسارات بين الأصدقاء
    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        for (const friend of linkedFriends) {
            if (friend?.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
                const layerId = `route-${currentUser.userId}-${friend.userId}`;
                await drawRoadRouteBetweenPoints(currentUser.location.coordinates, friend.location.coordinates, layerId);
            }
        }
    }

    if (hasVisibleUsers && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 1000 });
    } else if (currentUser?.location?.coordinates) {
        map.flyTo({ center: currentUser.location.coordinates, zoom: 14, duration: 1000 });
    } else {
        alert("لا توجد مواقع متاحة لعرضها. تأكد من تفعيل مشاركة الموقع لك ولأصدقائك.");
        map.flyTo({ center: [43.6875, 33.3152], zoom: 6, duration: 1000 });
    }
    if (refreshFriendsMapBtn) refreshFriendsMapBtn.style.display = 'flex';
}

// دالة عرض المضيفين (تم الاستبدال من الكود النصي)
function showAllMoazebOnMap() {
    socket.emit('getAllMoazeb');
}

async function drawRoadRouteBetweenPoints(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords) return null;
    if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(layerId)) map.removeSource(layerId);
    try {
        const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords.join(',')};${endCoords.join(',')}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`);
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const routeGeometry = data.routes[0].geometry;
            map.addSource(layerId, { 'type': 'geojson', 'data': { 'type': 'Feature', 'properties': {}, 'geometry': routeGeometry } });
            map.addLayer({ 'id': layerId, 'type': 'line', 'source': layerId, 'layout': { 'line-join': 'round', 'line-cap': 'round' }, 'paint': { 'line-color': '#15793c', 'line-width': 4, 'line-dasharray': [0.5, 2] } });
            return routeGeometry;
        }
    } catch (error) { console.error(`خطأ في رسم المسار ${layerId}:`, error); }
    return null;
}

function clearHistoricalPath() { if (currentHistoricalPathLayer && map.getLayer(currentHistoricalPathLayer)) { map.removeLayer(currentHistoricalPathLayer); map.removeSource(currentHistoricalPathLayer); currentHistoricalPathLayer = null; } }

function drawHistoricalPath(userId, pathCoordinates) {
    clearHistoricalPath();
    if (pathCoordinates.length < 2) return;
    const layerId = `historical-path-${userId}`; currentHistoricalPathLayer = layerId;
    map.addSource(layerId, { 'type': 'geojson', 'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': pathCoordinates } } });
    map.addLayer({ 'id': layerId, 'type': 'line', 'source': layerId, 'layout': { 'line-join': 'round', 'line-cap': 'round' }, 'paint': { 'line-color': '#FF00FF', 'line-width': 6, 'line-opacity': 0.8 } });
    const bounds = new mapboxgl.LngLatBounds(); pathCoordinates.forEach(coord => bounds.extend(coord)); map.fitBounds(bounds, { padding: 50 });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const φ1 = lat1 * Math.PI/180; const φ2 = lat2 * Math.PI/180; const Δφ = (lat2-lat1) * Math.PI/180; const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // المسافة بالأمتار
}

function startLocationTracking() {
    if (!navigator.geolocation) { alert("متصفحك لا يدعم تحديد المواقع."); return; }
    if (!currentUser) { console.warn("لا يمكن بدء تتبع الموقع: بيانات المستخدم غير متاحة."); return; }
    navigator.geolocation.watchPosition(
        async (position) => {
            const { longitude, latitude } = position.coords;
            socket.emit('updateLocation', { userId: currentUser.userId, location: [longitude, latitude], battery: await getBatteryStatus() });

            if (isNavigating && routeEndCoords) {
                const distanceToDestination = calculateDistance(latitude, longitude, routeEndCoords[1], routeEndCoords[0]);
                if (distanceToDestination < 50) { 
                    speak("الحمد لله على السلامة. لقد وصلت إلى وجهتك.");
                    alert("لقد وصلت إلى وجهتك!");
                    clearRoute();
                    return;
                }

                if (currentStepIndex < navigationSteps.length) {
                    const nextStep = navigationSteps[currentStepIndex];
                    const nextManeuverCoords = nextStep.maneuver.location;
                    const distanceToManeuver = calculateDistance(latitude, longitude, nextManeuverCoords[1], nextManeuverCoords[0]);

                    if (distanceToManeuver < 100) {
                        let instruction = nextStep.maneuver.instruction.replace(/(\d+)\s*m/, (match, p1) => `${p1} متر`);
                        speak(instruction);
                        currentStepIndex++;
                    }
                }
            }
        },
        (error) => { console.error("خطأ في تحديد الموقع:", error); },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
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

function playNotificationSound() { 
    if (currentUser && currentUser.settings.sound) new Audio('https://www.soundjay.com/buttons/beep-07.mp3').play().catch(e => {}); 
}

function playSOSSound() { 
    if (currentUser && currentUser.settings.sound) new Audio('https://www.soundjay.com/misc/emergency-alert-911-01.mp3').play().catch(e => {}); 
}

function playProximitySound() { 
    if (currentUser && currentUser.settings.sound && !proximityAlertPlayed) { 
        new Audio('https://www.soundjay.com/mechanical/sounds/car-horn-01.mp3').play().catch(e => {}); 
        proximityAlertPlayed = true; 
        setTimeout(() => { proximityAlertPlayed = false; }, 30000); 
    } 
}

function playPrayerSound() { 
    if (currentUser && currentUser.settings.sound && !prayerAlertPlayed) { 
        new Audio('https://www.soundjay.com/religious/sounds/adhan-azan-01.mp3').play().catch(e => {}); 
        prayerAlertPlayed = true; 
        setTimeout(() => { prayerAlertPlayed = false; }, 60000); 
    } 
}

function convertTimeToMinutes(timeStr) { 
    const [time, period] = timeStr.split(' '); 
    const [hours, minutes] = time.split(':').map(Number); 
    let totalMinutes = hours * 60 + minutes; 
    if (period === 'PM' && hours !== 12) totalMinutes += 720; 
    if (period === 'AM' && hours === 12) totalMinutes -= 720; 
    return totalMinutes; 
}

function checkPrayerTime(prayerTime) { 
    if (!prayerTime || prayerTime === lastPrayerTime) return; 
    lastPrayerTime = prayerTime; 
    const now = new Date(); 
    const currentTime = now.getHours() * 60 + now.getMinutes(); 
    const prayerMinutes = convertTimeToMinutes(prayerTime); 
    if (Math.abs(currentTime - prayerMinutes) < 5) playPrayerSound(); 
}

function sendMessageFromBottomBar() { 
    const input = document.getElementById('bottomChatInput'); 
    const message = input.value.trim(); 
    if (!currentUser) return; 
    if (!currentChatFriendId) { 
        alert("اختر صديقاً للدردشة."); 
        return; 
    } 
    if (message) { 
        if (document.getElementById('chatPanel').classList.contains('active')) addChatMessage(currentUser.name, message, 'sent', new Date()); 
        socket.emit('chatMessage', { senderId: currentUser.userId, receiverId: currentChatFriendId, message: message }); 
        if (currentUser.settings.sound) playNotificationSound(); 
        if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, message); 
        input.value = ''; 
    } 
}

function addChatMessage(sender, msg, type, timestamp) { 
    const chatDiv = document.getElementById('chatMessages'); 
    const msgEl = document.createElement('div'); 
    msgEl.className = `message ${type}`; 
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); 
    msgEl.innerHTML = `<span class="message-meta">${sender} - ${time}</span><br>${msg}`; 
    chatDiv.appendChild(msgEl); 
    chatDiv.scrollTop = chatDiv.scrollHeight; 
}

function showMessageBubble(userId, message) { 
    const bubble = document.getElementById(`msg-bubble-${userId}`); 
    if (bubble) { 
        if (activeMessageTimers[userId]) clearTimeout(activeMessageTimers[userId]); 
        bubble.textContent = message; 
        bubble.classList.add('show'); 
        activeMessageTimers[userId] = setTimeout(() => bubble.classList.remove('show'), 30000); 
    } 
}

function updateFriendBatteryStatus() { 
    const list = document.getElementById('friendBatteryStatus'); 
    list.innerHTML = ''; 
    if (linkedFriends.length > 0) linkedFriends.forEach(f => list.innerHTML += `<li>${f.name}: ${f.batteryStatus || 'N/A'}</li>`); 
    else list.innerHTML = '<li>لا يوجد أصدقاء.</li>'; 
}

function fetchAndDisplayPrayerTimes() { 
    document.getElementById('prayerTimesDisplay').innerHTML = 'جاري الجلب...'; 
    socket.emit('requestPrayerTimes'); 
}

function setupChatPanel() { 
    const select = document.getElementById('chatFriendSelect'); 
    const chatDiv = document.getElementById('chatMessages'); 
    select.innerHTML = ''; 
    if (linkedFriends.length > 0) { 
        linkedFriends.forEach(f => select.innerHTML += `<option value="${f.userId}">${f.name}</option>`); 
        currentChatFriendId = document.getElementById('bottomChatFriendSelect').value || linkedFriends[0].userId; 
        select.value = currentChatFriendId; 
        chatDiv.innerHTML = 'جاري تحميل الرسائل...'; 
        socket.emit('requestChatHistory', { friendId: currentChatFriendId }); 
    } else { 
        currentChatFriendId = null; 
        chatDiv.innerHTML = 'لا يوجد أصدقاء للدردشة.'; 
    } 
    select.removeEventListener('change', handleChatFriendChange); 
    select.addEventListener('change', handleChatFriendChange); 
}

function handleChatFriendChange(e) { 
    currentChatFriendId = e.target.value; 
    document.getElementById('bottomChatFriendSelect').value = currentChatFriendId; 
    const chatDiv = document.getElementById('chatMessages'); 
    if (chatDiv) chatDiv.innerHTML = 'جاري تحميل الرسائل...'; 
    socket.emit('requestChatHistory', { friendId: currentChatFriendId }); 
}

function setupBottomChatBar() { 
    const bar = document.getElementById('bottomChatBar'); 
    const select = document.getElementById('bottomChatFriendSelect'); 
    if (linkedFriends.length > 0) { 
        select.innerHTML = ''; 
        linkedFriends.forEach(f => select.innerHTML += `<option value="${f.userId}">${f.name}</option>`); 
        if (!currentChatFriendId || !linkedFriends.some(f => f.userId === currentChatFriendId)) currentChatFriendId = linkedFriends[0].userId; 
        select.value = currentChatFriendId; 
        bar.classList.add('active'); 
    } else { 
        bar.classList.remove('active'); 
        currentChatFriendId = null; 
    } 
    select.removeEventListener('change', (e) => { currentChatFriendId = e.target.value; }); 
    select.addEventListener('change', (e) => { currentChatFriendId = e.target.value; }); 
}

function updateMyCreationsList() { 
    const list = document.getElementById('myCreationsList'); 
    const poisList = document.getElementById('userPOIsList'); 
    if (!list || !poisList || !currentUser) return; 
    list.innerHTML = ''; 
    poisList.innerHTML = ''; 
    let contentAdded = false; 
    
    if (currentUser.meetingPoint?.name) { 
        list.innerHTML += `<p><strong>نقطة تجمع:</strong> ${currentUser.meetingPoint.name}</p>`; 
        contentAdded = true; 
    } 
    
    if (currentUser.createdPOIs?.length > 0) { 
        list.innerHTML += `<p><strong>نقاط الاهتمام (${currentUser.createdPOIs.length}):</strong></p>`; 
        const ul = document.createElement('ul'); 
        currentUser.createdPOIs.forEach(poi => { 
            ul.innerHTML += `<li>${poi.name} (${poi.category})</li>`; 
            poisList.innerHTML += `<li>${poi.name} (${poi.category}) <button class="delete-poi-btn-small" data-poi-id="${poi._id}"><i class="fas fa-trash"></i></button></li>`; 
        }); 
        list.appendChild(ul); 
        poisList.querySelectorAll('.delete-poi-btn-small').forEach(btn => btn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            if (confirm('هل أنت متأكد؟')) socket.emit('deletePOI', { poiId: e.currentTarget.dataset.poiId }); 
        })); 
        contentAdded = true; 
    } 
    
    if (!contentAdded) { 
        list.innerHTML = 'لم تقم بإضافة أي شيء بعد.'; 
    } 
}

function captureMap() {
    try {
        map.once('idle', function() {
            const canvas = map.getCanvas();
            const dataURL = canvas.toDataURL('image/png');
            
            const link = document.createElement('a');
            link.href = dataURL;
            link.download = `map_tareeqaljannah_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert('تم حفظ صورة الخريطة بنجاح!');
        });
        map.resize();
    } catch (error) {
        console.error('خطأ في التقاط الصورة:', error);
        alert('حدث خطأ أثناء التقاط الصورة. تأكد من أن متصفحك محدث.');
    }
}

function setupMapControls() {
    const controlsDiv = document.createElement('div'); controlsDiv.className = 'map-controls';
    const zoomInBtn = document.createElement('button'); zoomInBtn.className = 'map-control-btn'; zoomInBtn.innerHTML = '<i class="fas fa-plus"></i>'; zoomInBtn.title = 'تكبير'; zoomInBtn.addEventListener('click', () => map.zoomIn());
    const zoomOutBtn = document.createElement('button'); zoomOutBtn.className = 'map-control-btn'; zoomOutBtn.innerHTML = '<i class="fas fa-minus"></i>'; zoomOutBtn.title = 'تصغير'; zoomOutBtn.addEventListener('click', () => map.zoomOut());
    const rotateBtn = document.createElement('button'); rotateBtn.className = 'map-control-btn'; rotateBtn.innerHTML = '<i class="fas fa-compass"></i>'; rotateBtn.title = 'إعادة توجيه'; rotateBtn.addEventListener('click', () => map.resetNorthPitch());
    const toggleHeaderBtn = document.createElement('button'); toggleHeaderBtn.className = 'map-control-btn'; toggleHeaderBtn.innerHTML = '<i class="fas fa-eye-slash"></i>'; toggleHeaderBtn.title = 'إخفاء الشريط العلوي'; toggleHeaderBtn.addEventListener('click', () => { document.body.classList.toggle('header-hidden'); setTimeout(() => map.resize(), 300); });
    
    const captureBtn = document.createElement('button'); 
    captureBtn.className = 'map-control-btn capture-btn'; 
    captureBtn.innerHTML = '<i class="fas fa-camera"></i>'; 
    captureBtn.title = 'التقاط صورة للخريطة'; 
    captureBtn.addEventListener('click', captureMap);
    
    refreshFriendsMapBtn = document.createElement('button');
    refreshFriendsMapBtn.className = 'map-control-btn';
    refreshFriendsMapBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    refreshFriendsMapBtn.title = 'تحديث خريطة الأصدقاء';
    refreshFriendsMapBtn.style.display = 'none';
    refreshFriendsMapBtn.addEventListener('click', () => {
        if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
            alert('جارٍ تحديث بيانات ومسارات الأصدقاء...');
            showFriendsMap();
        }
    });

    // إنشاء زر إعادة تركيز الرحلة
    refocusRouteBtn = document.createElement('button');
    refocusRouteBtn.className = 'map-control-btn refocus-route-btn';
    refocusRouteBtn.innerHTML = '<i class="fas fa-route"></i>';
    refocusRouteBtn.title = 'إعادة تركيز الرحلة';
    refocusRouteBtn.style.display = 'none'; // إخفاؤه مبدئياً
    refocusRouteBtn.addEventListener('click', () => {
        if (activeRouteBounds && !activeRouteBounds.isEmpty()) {
            map.fitBounds(activeRouteBounds, { padding: 80 });
        }
    });

    const styleSwitcherBtn = document.createElement('button'); styleSwitcherBtn.className = 'map-control-btn'; styleSwitcherBtn.innerHTML = '<i class="fas fa-layer-group"></i>'; styleSwitcherBtn.title = 'تغيير نمط الخريطة';
    const styleSwitcherContainer = document.createElement('div'); styleSwitcherContainer.id = 'map-style-switcher';
    const styles = [{ name: 'شوارع', id: 'mapbox://styles/mapbox/streets-v11' }, { name: 'قمر صناعي', id: 'mapbox://styles/mapbox/satellite-streets-v12' }, { name: 'تضاريس', id: 'mapbox://styles/mapbox/outdoors-v12' }];
    styles.forEach(style => { const btn = document.createElement('button'); btn.className = 'style-btn'; btn.textContent = style.name; btn.dataset.styleId = style.id; if (map.getStyle().sprite.includes(style.id)) btn.classList.add('active'); btn.addEventListener('click', () => { map.setStyle(style.id); document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }); styleSwitcherContainer.appendChild(btn); });
    styleSwitcherBtn.addEventListener('click', () => styleSwitcherContainer.classList.toggle('active'));

    controlsDiv.appendChild(zoomInBtn); controlsDiv.appendChild(zoomOutBtn); controlsDiv.appendChild(rotateBtn); controlsDiv.appendChild(toggleHeaderBtn); controlsDiv.appendChild(captureBtn); controlsDiv.appendChild(refreshFriendsMapBtn); controlsDiv.appendChild(refocusRouteBtn); controlsDiv.appendChild(styleSwitcherBtn); controlsDiv.appendChild(styleSwitcherContainer);
    document.getElementById('map').appendChild(controlsDiv);
}

function updateFriendsPanelList() { 
    const list = document.getElementById('friendsList'); 
    if (!list) return; 
    list.innerHTML = ''; 
    let contentAdded = false;

    if (linkedFriends.length > 0) { 
        linkedFriends.forEach(f => { 
            const li = document.createElement('li'); 
            li.innerHTML = `
                <img src="${f.photo}" class="list-item-photo" onerror="this.src='image/husseini_avatar.png'"> 
                <span>${f.name}</span> 
                <span class="list-item-status">${f.batteryStatus||'N/A'}</span> 
                <button class="unfriend-in-list-btn" data-friend-id="${f.userId}" title="إلغاء الربط"><i class="fas fa-user-minus"></i></button>
                <button class="reconnect-in-list-btn" data-friend-id="${f.userId}" title="إعادة رسم المسار"><i class="fas fa-route"></i></button>
            `; 
            list.appendChild(li); 
        }); 
        contentAdded = true;
    }

    if (currentUser && currentUser.linkedMoazeb && currentUser.linkedMoazeb.moazebId) {
        const moazeb = currentUser.linkedMoazeb.moazebId;
        const li = document.createElement('li');
        li.innerHTML = `
            <i class="fas fa-home list-item-icon"></i>
            <span>${moazeb.name} (مضيف)</span>
            <span class="list-item-status">${moazeb.phone}</span>
            <button class="unlink-moazeb-in-list-btn" title="إلغاء الربط"><i class="fas fa-unlink"></i></button>
            <button class="reconnect-moazeb-in-list-btn" title="إعادة رسم المسار"><i class="fas fa-route"></i></button>
        `;
        list.appendChild(li);
        contentAdded = true;
    }
    
    if (!contentAdded) { 
        list.innerHTML = '<li>لا يوجد أصدقاء أو مضيف مرتبط حالياً.</li>'; 
    } 

    document.querySelectorAll('.unfriend-in-list-btn').forEach(btn => { 
        btn.addEventListener('click', (e) => { 
            e.stopPropagation();
            const friendId = e.currentTarget.dataset.friendId; 
            const friendName = linkedFriends.find(f => f.userId === friendId)?.name || 'هذا الصديق'; 
            if (confirm(`هل أنت متأكد من إلغاء الارتباط بـ ${friendName}؟`)) socket.emit('unfriendUser', { friendId }); 
        }); 
    });
    
    document.querySelectorAll('.reconnect-in-list-btn').forEach(btn => { 
        btn.addEventListener('click', (e) => { 
            e.stopPropagation();
            const friendId = e.currentTarget.dataset.friendId;
            const friend = linkedFriends.find(f => f.userId === friendId);
            if (friend && currentUser?.location?.coordinates && friend.location) {
                drawRoadRouteBetweenPoints(currentUser.location.coordinates, friend.location.coordinates, `route-${currentUser.userId}-${friend.userId}`);
                alert(`تم إعادة رسم المسار مع ${friend.name}`);
                togglePanel(null);
                showFriendsMap();
            } else {
                alert('لا يمكن رسم المسار. تأكد من توفر موقعك وموقع صديقك.');
            }
        }); 
    });

    const unlinkMoazebBtn = document.querySelector('.unlink-moazeb-in-list-btn');
    if(unlinkMoazebBtn) {
        unlinkMoazebBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if(confirm('هل تريد إلغاء الربط مع المضيف؟')) socket.emit('unlinkFromMoazeb');
        });
    }

    const reconnectMoazebBtn = document.querySelector('.reconnect-moazeb-in-list-btn');
    if(reconnectMoazebBtn) {
        reconnectMoazebBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if(currentUser?.linkedMoazeb?.connectionLine) {
                drawMoazebConnectionLine(currentUser.linkedMoazeb.connectionLine);
                alert('تم إعادة رسم المسار إلى المضيف.');
                togglePanel(null);
            }
        });
    }
}

function updatePreviousFriendsList() {
    const list = document.getElementById('previousFriendsList');
    if (!list) return;
    list.innerHTML = '';
    socket.emit('requestPreviousFriends');
}

function refreshFriendsData() { 
    if (currentUser?.linkedFriends?.length > 0) socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends }); 
}

function showFriendRequestDialog(request) {
    const existingDialog = document.querySelector('.friend-request-dialog');
    if (existingDialog) existingDialog.remove();

    const dialog = document.createElement('div');
    dialog.className = 'friend-request-dialog';
    
    dialog.innerHTML = `
        <h3>طلب ربط</h3>
        <img src="${request.fromUserPhoto}" onerror="this.src='image/husseini_avatar.png'" class="list-item-photo">
        <p><strong>${request.fromUserName}</strong> يريد الربط معك</p>
        <div class="dialog-buttons">
            <button id="acceptRequestBtn" class="accept-btn">قبول</button>
            <button id="rejectRequestBtn" class="reject-btn">رفض</button>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    document.getElementById('acceptRequestBtn').addEventListener('click', () => {
        socket.emit('respondToFriendRequest', { fromUserId: request.fromUserId, accepted: true });
        document.body.removeChild(dialog);
    });
    
    document.getElementById('rejectRequestBtn').addEventListener('click', () => {
        socket.emit('respondToFriendRequest', { fromUserId: request.fromUserId, accepted: false });
        document.body.removeChild(dialog);
    });
}

// التعامل مع أحداث WebSocket
socket.on('connect', () => { 
    let userId = localStorage.getItem('appUserId'); 
    if (!userId) { 
        userId = 'user_' + Math.random().toString(36).substring(2, 15); 
        localStorage.setItem('appUserId', userId); 
    } 
    const data = { 
        userId, 
        name: localStorage.getItem('appUserName'), 
        photo: localStorage.getItem('appUserPhoto'), 
        gender: localStorage.getItem('appUserGender'), 
        phone: localStorage.getItem('appUserPhone'), 
        email: localStorage.getItem('appUserEmail'), 
        emergencyWhatsapp: localStorage.getItem('appEmergencyWhatsapp') 
    }; 
    socket.emit('registerUser', data); 
});

socket.on('currentUserData', (user) => {
    currentUser = user;
    Object.keys(currentUser).forEach(key => localStorage.setItem(`appUser${key.charAt(0).toUpperCase() + key.slice(1)}`, currentUser[key]));
    localStorage.setItem('appEmergencyWhatsapp', currentUser.settings.emergencyWhatsapp || '');
    document.getElementById('userName').textContent = currentUser.name; 
    document.getElementById('userPhoto').src = currentUser.photo; 
    document.getElementById('userLinkCode').textContent = currentUser.linkCode;
    document.getElementById('editUserNameInput').value = currentUser.name; 
    document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';
    ['editGenderSelect', 'editPhoneInput', 'editEmailInput', 'initialInfoNameInput', 'initialInfoGenderSelect', 'initialInfoPhoneInput', 'initialInfoEmailInput'].forEach(id => document.getElementById(id).value = currentUser[id.replace('edit', '').replace('Input', '').replace('Select', '').toLowerCase().replace('initialinfo', '')] || (id.includes('Gender') ? 'other' : ''));
    ['shareLocation', 'sound', 'hideBubbles', 'stealthMode', 'showPhone', 'showEmail'].forEach(id => document.getElementById(`${id}Toggle`).checked = currentUser.settings[id]);
    updateMyCreationsList();
    startLocationTracking();
    if (currentUser.linkedFriends?.length > 0) { 
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends }); 
    }
    if (!localStorage.getItem('appUserName') || !localStorage.getItem('appUserGender') || localStorage.getItem('appUserGender') === 'other' || !localStorage.getItem('appUserPhone') || !localStorage.getItem('appUserEmail')) { 
        document.getElementById('initialInfoPanel').classList.add('active'); 
    } else { 
        document.getElementById('initialInfoPanel').classList.remove('active'); 
    }
    
    if (currentUser.linkedMoazeb && currentUser.linkedMoazeb.connectionLine) {
        drawMoazebConnectionLine(currentUser.linkedMoazeb.connectionLine);
    }
});

socket.on('locationUpdate', (data) => { 
    if (currentUser && data.userId === currentUser.userId) {
        currentUser.location = { type: 'Point', coordinates: data.location };
        currentUser.batteryStatus = data.batteryStatus;
        currentUser.lastSeen = data.lastSeen;
    }
    let userToUpdate = (currentUser && data.userId === currentUser.userId) ? currentUser : linkedFriends.find(f => f.userId === data.userId); 
    if (userToUpdate) { 
        userToUpdate.location = { type: 'Point', coordinates: data.location }; 
        const marker = friendMarkers[userToUpdate.userId]; 
        const isVisible = userToUpdate.settings.shareLocation && !userToUpdate.settings.stealthMode; 
        if (isVisible) { 
            if (marker) marker.setLngLat(userToUpdate.location.coordinates); 
            else createCustomMarker(userToUpdate); 
        } else if (marker) { 
            marker.remove(); 
            delete friendMarkers[userToUpdate.userId]; 
        } 
    } 
});

socket.on('linkStatus', (data) => { 
    alert(data.message); 
    if (data.success) { 
        socket.emit('registerUser', { userId: currentUser.userId }); 
        setupBottomChatBar(); 
    } 
});

socket.on('unfriendStatus', (data) => { 
    alert(data.message); 
    if (data.success) { 
        speak("تم إلغاء الربط.");
        socket.emit('registerUser', { userId: currentUser.userId }); 
        if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
             showFriendsMap();
        } else {
             showGeneralMap();
        }
    } 
});

socket.on('updateFriendsList', (friendsData) => { 
    linkedFriends = friendsData; 
    if (document.getElementById('showFriendsMapBtn').classList.contains('active')) showFriendsMap(); 
    setupBottomChatBar(); 
    if (document.getElementById('connectPanel').classList.contains('active')) updateFriendsPanelList(); 
    updateFriendBatteryStatus(); 
});

socket.on('friendRequestReceived', (request) => {
    speak(`لديك طلب ربط جديد من ${request.fromUserName}`);
    showFriendRequestDialog(request);
});

socket.on('friendRequestAccepted', (data) => {
    alert(data.message);
    speak(`تم الربط بنجاح مع ${data.byUserName}`);
    socket.emit('registerUser', { userId: currentUser.userId });
});

socket.on('friendRequestRejected', (data) => {
    alert(data.message);
});

socket.on('previousFriendsList', (previousFriends) => {
    const list = document.getElementById('previousFriendsList');
    if (!list) return;
    list.innerHTML = '';
    
    if (previousFriends && previousFriends.length > 0) {
        previousFriends.forEach(friend => {
            const li = document.createElement('li');
            const isCurrentlyLinked = linkedFriends.some(f => f.userId === friend.userId);
            const status = isCurrentlyLinked ? 'مرتبط حالياً' : (friend.unlinkedAt ? 'غير مرتبط' : 'مرتبط');
            li.innerHTML = `
                <img src="${friend.photo || 'image/husseini_avatar.png'}" class="list-item-photo" onerror="this.src='image/husseini_avatar.png'"> 
                <span>${friend.name}</span> 
                <span class="list-item-status">${status}</span> 
                <button class="reconnect-previous-btn" data-friend-id="${friend.userId}" title="إعادة طلب الربط"><i class="fas fa-redo"></i></button>
            `;
            list.appendChild(li);
        });
        
        document.querySelectorAll('.reconnect-previous-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const friendId = e.currentTarget.dataset.friendId;
                socket.emit('reconnectWithFriend', { friendId });
            });
        });
    } else {
        list.innerHTML = '<li>لا يوجد أصدقاء سابقون في سجلك.</li>';
    }
});


socket.on('reconnectStatus', (data) => {
    alert(data.message);
});

socket.on('newChatMessage', (data) => { 
    if (currentUser && data.receiverId === currentUser.userId) { 
        if (!currentUser.settings.hideBubbles) showMessageBubble(data.senderId, data.message); 
        if (currentUser.settings.sound) playNotificationSound(); 
        if (data.senderId === currentChatFriendId && document.getElementById('chatPanel').classList.contains('active')) 
            addChatMessage(data.senderName, data.message, 'received', data.timestamp); 
    } 
});

socket.on('removeUserMarker', (data) => { 
    if (friendMarkers[data.userId]) { 
        friendMarkers[data.userId].remove(); 
        delete friendMarkers[data.userId]; 
    } 
    const layerId = `route-${currentUser.userId}-${data.userId}`; 
    if (map.getLayer(layerId)) map.removeLayer(layerId); 
    if (map.getSource(layerId)) map.removeSource(layerId); 
});

socket.on('newLinkEstablished', (data) => {
    const newFriend = data.friend;
    if (!newFriend) return;
    
    // إضافة الصديق الجديد إلى القائمة المحلية فوراً
    if (!linkedFriends.some(f => f.userId === newFriend.userId)) {
        linkedFriends.push(newFriend);
    }

    // رسم علامة الصديق على الخريطة
    if (newFriend.location?.coordinates) {
        createCustomMarker(newFriend);
    }
    
    // رسم خط المسار بينكما مباشرة
    if (currentUser?.location?.coordinates && newFriend.location?.coordinates) {
        drawRoadRouteBetweenPoints(
            currentUser.location.coordinates,
            newFriend.location.coordinates,
            `route-${currentUser.userId}-${newFriend.userId}`
        );
        speak("تم رسم المسار مع صديقك الجديد.");
    }
    
    // تحديث واجهة المستخدم التي قد تعتمد على قائمة الأصدقاء
    setupBottomChatBar();
});


socket.on('poiStatus', (data) => { 
    alert(data.message); 
    if (data.success) { 
        speak("تمت إضافة نقطة الاهتمام."); 
        socket.emit('registerUser', { userId: currentUser.userId }); 
    }
});

socket.on('newPOIAdded', (poi) => createPOIMarker(poi));
socket.on('poiDeletedBroadcast', (data) => { 
    if (poiMarkers[data.poiId]) { 
        poiMarkers[data.poiId].remove(); 
        delete poiMarkers[data.poiId]; 
    } 
});

socket.on('updatePOIsList', (poisData) => { 
    poisData.forEach(createPOIMarker); 
});

socket.on('historicalPathData', (data) => { 
    if (data.success) { 
        if (data.path?.length > 0) { 
            const coordinates = data.path.map(loc => loc.location.coordinates); 
            drawHistoricalPath(data.userId, coordinates); 
            alert('تم عرض المسار التاريخي.'); 
            togglePanel(null); 
            document.getElementById('showFriendsMapBtn').classList.add('active'); 
            showFriendsMap(); 
        } else { 
            alert('لا توجد بيانات مسار تاريخي.'); 
        } 
    } else { 
        alert(`فشل جلب المسار: ${data.message}`); 
    } 
});

socket.on('chatHistoryData', (data) => { 
    const chatDiv = document.getElementById('chatMessages'); 
    if (!chatDiv) return; 
    chatDiv.innerHTML = ''; 
    if (data.success && data.history?.length > 0) { 
        data.history.forEach(msg => { 
            const type = (msg.senderId === currentUser.userId) ? 'sent' : 'received'; 
            const sender = (msg.senderId === currentUser.userId) ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق'; 
            addChatMessage(sender, msg.message, type, msg.timestamp); 
        }); 
    } else { 
        chatDiv.innerHTML = '<p style="text-align:center;color:#777;">لا توجد رسائل سابقة.</p>'; 
    } 
});

socket.on('newMeetingPoint', (data) => { 
    createMeetingPointMarker(data); 
    if (currentUser && data.creatorId === currentUser.userId) { 
        speak("تم تحديد نقطة التجمع بنجاح."); 
        document.getElementById('endMeetingPointBtn').style.display = 'block'; 
        updateMyCreationsList(); 
    } 
});

socket.on('meetingPointCleared', (data) => { 
    if (meetingPointMarkers[data.creatorId]) { 
        meetingPointMarkers[data.creatorId].remove(); 
        delete meetingPointMarkers[data.creatorId]; 
        if (data.creatorId !== currentUser.userId) alert('تم إنهاء نقطة التجمع.'); 
    } 
    if (currentUser && data.creatorId === currentUser.userId) { 
        document.getElementById('endMeetingPointBtn').style.display = 'none'; 
        document.getElementById('meetingPointInput').value = ''; 
        updateMyCreationsList(); 
    } 
});

socket.on('moazebStatus', (data) => { 
    alert(data.message); 
    if (data.success) {
        ['addMoazebName', 'addMoazebAddress', 'addMoazebPhone', 'addMoazebGov', 'addMoazebDist'].forEach(id => document.getElementById(id).value = ''); 
        if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
            showFriendsMap();
        }
    }
});

socket.on('moazebSearchResults', (data) => { 
    const container = document.getElementById('moazebResultsContainer'); 
    container.innerHTML = ''; 
    clearAllMapLayers(); 
    if (data.success && data.results.length > 0) { 
        data.results.forEach(moazeb => { 
            createMoazebMarker(moazeb); 
        }); 
        const bounds = new mapboxgl.LngLatBounds(); 
        data.results.forEach(m => bounds.extend(m.location.coordinates)); 
        map.fitBounds(bounds, { padding: 50 }); 
    } else { 
        container.innerHTML = 'لا توجد نتائج.'; 
    } 
});

socket.on('allMoazebData', (data) => {
    if (data.success && data.moazebs) {
        Object.values(moazebMarkers).forEach(marker => marker.remove());
        Object.keys(moazebMarkers).forEach(key => delete moazebMarkers[key]);

        data.moazebs.forEach(createMoazebMarker);

        if (data.moazebs.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            data.moazebs.forEach(m => {
                if (m.location && m.location.coordinates) {
                    bounds.extend(m.location.coordinates);
                }
            });
            if (!bounds.isEmpty()){
                map.fitBounds(bounds, { padding: 50 });
            }
        }
    } else {
        alert('فشل في تحميل بيانات المضيفين.');
    }
});

socket.on('linkToMoazebStatus', (data) => { 
    alert(data.message); 
    if (data.success) { 
        speak("تم الربط مع المضيف."); 
        if (data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); 
        socket.emit('registerUser', { userId: currentUser.userId }); 
        if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
            showFriendsMap();
        }
    } 
});

socket.on('moazebConnectionData', (data) => { 
    if (data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); 
});

socket.on('moazebConnectionUpdate', (data) => { 
    if (data.connectionLine?.length > 0) drawMoazebConnectionLine(data.connectionLine); 
});

socket.on('unlinkFromMoazebStatus', (data) => { 
    alert(data.message); 
    if(data.success) { 
        speak("تم إلغاء الربط مع المضيف."); 
        socket.emit('registerUser', { userId: currentUser.userId }); 
    } 
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) { 
        map.removeLayer(moazebConnectionLayerId); 
        map.removeSource(moazebConnectionLayerId); 
        moazebConnectionLayerId = null; 
    } 
    if (document.getElementById('showFriendsMapBtn').classList.contains('active')) {
        showFriendsMap();
    }
});

socket.on('poiDeleted', (data) => { 
    if (data.success) { 
        if (poiMarkers[data.poiId]) { 
            poiMarkers[data.poiId].remove(); 
            delete poiMarkers[data.poiId]; 
        } 
        socket.emit('registerUser', { userId: currentUser.userId }); 
        alert('تم حذف نقطة الاهتمام.'); 
    } else { 
        alert(`فشل الحذف: ${data.message}`); 
    } 
});

socket.on('prayerTimesData', (data) => { 
    const el = document.getElementById('prayerTimesDisplay'); 
    if (data.success) { 
        const { Fajr, Dhuhr, Asr, Maghrib, Isha } = data.timings; 
        el.innerHTML = `<p><strong>الفجر:</strong> ${Fajr}</p><p><strong>الظهر:</strong> ${Dhuhr}</p><p><strong>العصر:</strong> ${Asr}</p><p><strong>المغرب:</strong> ${Maghrib}</p><p><strong>العشاء:</strong> ${Isha}</p>`; 
        Object.values(data.timings).forEach(checkPrayerTime); 
    } else { 
        el.innerHTML = `<p style="color:var(--danger-color);">${data.message || 'فشل جلب أوقات الصلاة.'}</p>`; 
    } 
});

map.on('load', () => { 
    map.setLanguage('ar'); 
    setupMapControls(); 
    showGeneralMap(); 
    document.getElementById('showGeneralMapBtn').classList.add('active'); 
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('showGeneralMapBtn').addEventListener('click', () => { 
        togglePanel(null); 
        showGeneralMap(); 
    });
    
    document.getElementById('showFriendsMapBtn').addEventListener('click', () => { 
        if (!currentUser) { 
            alert("جاري التحميل..."); 
            return; 
        } 
        togglePanel(null); 
        showFriendsMap(); 
        setupBottomChatBar(); 
    });
    
    document.getElementById('showAllMoazebBtn').addEventListener('click', showAllMoazebOnMap);

    document.getElementById('initialInfoConfirmBtn').addEventListener('click', () => { 
        const name = document.getElementById('initialInfoNameInput').value.trim(); 
        const gender = document.getElementById('initialInfoGenderSelect').value; 
        const phone = document.getElementById('initialInfoPhoneInput').value.trim(); 
        const email = document.getElementById('initialInfoEmailInput').value.trim(); 
        if (name && gender !== 'other' && phone && email) { 
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { 
                alert('بريد إلكتروني غير صحيح.'); 
                return; 
            } 
            localStorage.setItem('appUserName', name); 
            localStorage.setItem('appUserGender', gender); 
            localStorage.setItem('appUserPhone', phone); 
            localStorage.setItem('appUserEmail', email); 
            socket.emit('updateSettings', { name, gender, phone, email }); 
            document.getElementById('initialInfoPanel').classList.remove('active'); 
            alert('تم الحفظ.'); 
        } else { 
            alert('الرجاء ملء جميع الحقول.'); 
        } 
    });
    
    document.getElementById('showProfileBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        updateMyCreationsList(); 
        togglePanel('profilePanel'); 
    });
    
    document.getElementById('generateCodeBtn').addEventListener('click', () => alert('غير متاح حالياً.'));
    document.getElementById('copyLinkCodeBtn').addEventListener('click', () => { 
        const code = document.getElementById('userLinkCode').textContent; 
        if (code) navigator.clipboard.writeText(code).then(() => alert('تم نسخ الرمز!')).catch(err => alert('فشل النسخ.')); 
    });
    
    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        const newName = document.getElementById('editUserNameInput').value.trim(); 
        const newGender = document.getElementById('editGenderSelect').value; 
        const newPhone = document.getElementById('editPhoneInput').value.trim(); 
        const newEmail = document.getElementById('editEmailInput').value.trim(); 
        if (newName && newGender !== 'other' && newPhone && newEmail) { 
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { 
                alert('بريد إلكتروني غير صحيح.'); 
                return; 
            } 
            currentUser.name = newName; 
            currentUser.gender = newGender; 
            currentUser.phone = newPhone; 
            currentUser.email = newEmail; 
            localStorage.setItem('appUserName', newName); 
            localStorage.setItem('appUserGender', newGender); 
            localStorage.setItem('appUserPhone', newPhone); 
            localStorage.setItem('appUserEmail', newEmail); 
            socket.emit('updateSettings', { name: newName, gender: newGender, phone: newPhone, email: newEmail }); 
            alert('تم الحفظ!'); 
        } else { 
            alert('الرجاء ملء جميع الحقول.'); 
        } 
    });
    
    document.getElementById('showConnectBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        togglePanel('connectPanel'); 
        updateFriendsPanelList(); 
        updatePreviousFriendsList(); 
    });
    
    document.getElementById('connectFriendBtn').addEventListener('click', (e) => { 
        e.stopPropagation();
        const code = document.getElementById('friendCodeInput').value.trim(); 
        if (!currentUser) return; 
        if (code) { 
            socket.emit('requestLink', { friendCode: code }); 
            document.getElementById('friendCodeInput').value = ''; 
        } else { 
            alert('أدخل رمز الربط.'); 
        } 
    });
    
    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessageFromBottomBar(); });
    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => { 
        if (!currentUser || linkedFriends.length === 0) { 
            alert("اربط صديقاً أولاً."); 
            return; 
        } 
        togglePanel('chatPanel'); 
        setupChatPanel(); 
    });
    
    document.getElementById('showFeaturesBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        const select = document.getElementById('historicalPathUserSelect'); 
        if (select) { 
            select.innerHTML = `<option value="${currentUser.userId}">${currentUser.name} (أنا)</option>`; 
            linkedFriends.forEach(f => select.innerHTML += `<option value="${f.userId}">${f.name}</option>`); 
        } 
        togglePanel('featuresPanel'); 
        updateFriendBatteryStatus(); 
        fetchAndDisplayPrayerTimes(); 
    });
    
    document.getElementById('viewHistoricalPathBtn').addEventListener('click', () => { 
        const userId = document.getElementById('historicalPathUserSelect').value; 
        if (userId) socket.emit('requestHistoricalPath', { targetUserId: userId, limit: 200 }); 
        else alert("اختر مستخدماً."); 
    });
    
    document.getElementById('clearHistoricalPathBtn').addEventListener('click', () => { 
        clearHistoricalPath(); 
        alert('تم مسح المسار.'); 
    });
    
    const poiCategorySelect = document.getElementById('poiCategorySelect'); 
    if (poiCategorySelect) {
        ['Rest Area', 'Medical Post', 'Food Station', 'Water', 'Mosque', 'Parking', 'Info', 'Other'].forEach(cat => 
            poiCategorySelect.innerHTML += `<option value="${cat}">${cat}</option>`
        );
    }
    
    document.getElementById('addPoiBtn').addEventListener('click', () => { 
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) { 
            alert("موقعك غير متاح."); 
            return; 
        } 
        const name = prompt("اسم نقطة الاهتمام:"); 
        if (name) { 
            const desc = prompt("الوصف (اختياري):"); 
            const category = document.getElementById('poiCategorySelect').value; 
            const iconMap = { 
                'Rest Area': '<i class="fas fa-bed"></i>', 
                'Medical Post': '<i class="fas fa-medkit"></i>', 
                'Food Station': '<i class="fas fa-utensils"></i>', 
                'Water': '<i class="fas fa-tint"></i>', 
                'Mosque': '<i class="fas fa-mosque"></i>', 
                'Parking': '<i class="fas fa-parking"></i>', 
                'Info': '<i class="fas fa-info-circle"></i>', 
                'Other': '<i class="fas fa-map-marker-alt"></i>' 
            }; 
            socket.emit('addCommunityPOI', { 
                name, 
                description: desc, 
                category, 
                location: currentUser.location.coordinates, 
                icon: iconMap[category] || iconMap['Other'] 
            }); 
        } 
    });
    
    document.getElementById('whatsappHelpBtn').addEventListener('click', () => 
        window.open(`https://wa.me/9647708077310?text=${encodeURIComponent("السلام عليكم، لدي استفسار.")}`, '_blank')
    );
    
    document.getElementById('sosButton').addEventListener('click', () => { 
        if (!currentUser) return; 
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp; 
        if (!emergencyWhatsapp || emergencyWhatsapp.length < 5) { 
            alert("أضف رقم واتساب للطوارئ في الإعدادات."); 
            return; 
        } 
        if (confirm("هل تريد إرسال SOS؟")) { 
            if (currentUser.settings.sound) playSOSSound(); 
            let message = "مساعدة عاجلة!\n"; 
            if (currentUser.location?.coordinates) { 
                const [lng, lat] = currentUser.location.coordinates; 
                message += `موقعي: https://www.google.com/maps?q=${lat},${lng}\n`; 
            } else { 
                message += "موقعي غير متاح."; 
            } 
            message += `\nمن: ${currentUser.name}`; 
            window.open(`https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`, '_blank'); 
            alert("تم فتح واتساب لإرسال الرسالة."); 
        } 
    });
    
    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);
    
    document.getElementById('setMeetingPointBtn').addEventListener('click', () => { 
        const name = document.getElementById('meetingPointInput').value.trim(); 
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 || currentUser.location.coordinates[1] === 0)) { 
            alert("موقعك غير متاح."); 
            return; 
        } 
        if (name) {
            socket.emit('setMeetingPoint', { name, location: currentUser.location.coordinates }); 
        } else { 
            alert("أدخل اسم لنقطة التجمع."); 
        } 
    });
    
    document.getElementById('endMeetingPointBtn').addEventListener('click', () => { 
        if (confirm('هل تريد إنهاء نقطة التجمع؟')) 
            socket.emit('clearMeetingPoint'); 
    });
    
    document.getElementById('showMoazebBtn').addEventListener('click', () => togglePanel('moazebPanel'));
    
    document.getElementById('addMoazebBtn').addEventListener('click', (e) => { 
        e.stopPropagation();
        if (!currentUser?.location?.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) { 
            alert("موقعك غير متاح."); 
            return; 
        } 
        const data = { 
            name: document.getElementById('addMoazebName').value.trim(), 
            address: document.getElementById('addMoazebAddress').value.trim(), 
            phone: document.getElementById('addMoazebPhone').value.trim(), 
            governorate: document.getElementById('addMoazebGov').value.trim(), 
            district: document.getElementById('addMoazebDist').value.trim(), 
            type: document.getElementById('addMoazebType').value, 
            location: currentUser.location.coordinates 
        }; 
        if (!data.name || !data.address || !data.phone || !data.governorate || !data.district) { 
            alert('املأ جميع الحقول.'); 
            return; 
        } 
        if (!/^07\d{9}$/.test(data.phone)) { 
            alert('رقم الهاتف يجب أن يبدأ بـ 07 (11 رقم).'); 
            return; 
        } 
        socket.emit('addMoazeb', data); 
    });
    
    document.getElementById('searchMoazebBtn').addEventListener('click', (e) => { 
        e.stopPropagation();
        const query = { 
            phone: document.getElementById('searchMoazebPhone').value.trim(), 
            governorate: document.getElementById('searchMoazebGov').value.trim(), 
            district: document.getElementById('searchMoazebDist').value.trim() 
        }; 
        if (!query.phone && !query.governorate && !query.district) { 
            alert('أدخل معيار بحث واحد على الأقل.'); 
            return; 
        } 
        socket.emit('searchMoazeb', query); 
    });
    
    document.getElementById('unlinkFromMoazebBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!currentUser || !currentUser.linkedMoazeb) {
            alert('أنت غير مرتبط بأي مضيف حالياً.');
            return;
        }
        if (confirm('هل تريد إلغاء الربط مع المضيف الحالي؟')) {
            socket.emit('unlinkFromMoazeb');
        }
    });
    
    document.getElementById('showSettingsBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        togglePanel('settingsPanel'); 
    });
    
    ['shareLocation', 'sound', 'hideBubbles', 'stealthMode', 'showPhone', 'showEmail'].forEach(id => 
        document.getElementById(`${id}Toggle`).addEventListener('change', (e) => { 
            if (currentUser) socket.emit('updateSettings', { [id]: e.target.checked }); 
        })
    );
    
    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => { 
        if (!currentUser) return; 
        const newWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim(); 
        if (newWhatsapp) { 
            currentUser.settings.emergencyWhatsapp = newWhatsapp; 
            localStorage.setItem('appEmergencyWhatsapp', newWhatsapp); 
            socket.emit('updateSettings', { emergencyWhatsapp: newWhatsapp }); 
            alert('تم حفظ الرقم!'); 
        } else { 
            alert('أدخل رقم صحيح.'); 
        } 
    });
    
    document.getElementById('showDirectionsBtn').addEventListener('click', () => 
        togglePanel('directionsPanel')
    );
    
    const mapSearchInput = document.getElementById('mapSearchInput'); 
    const searchResults = document.getElementById('searchResults'); 
    const endPointInput = document.getElementById('endPointInput');
    
    // دالة المعالجة العامة للبحث (تم استبدالها من الكود النصي)
    async function handleSearchInput(e, resultsContainerId) { 
        const query = e.target.value; 
        const resultsContainer = document.getElementById(resultsContainerId); 
        if (query.length < 2) { 
            resultsContainer.style.display = 'none'; 
            return; 
        } 
        const [globalResults, localResults] = await Promise.all([searchPlaces(query), searchVisibleFeatures(query)]); 
        const combined = [...globalResults]; 
        const existingNames = new Set(globalResults.map(r => r.place_name_ar || r.place_name)); 
        localResults.forEach(local => { 
            if (!existingNames.has(local.place_name_ar)) combined.push(local); 
        }); 
        displaySearchResults(combined, resultsContainerId); 
    }
    
    mapSearchInput.addEventListener('input', (e) => handleSearchInput(e, 'searchResults')); 
    endPointInput.addEventListener('input', (e) => handleSearchInput(e, 'endPointSuggestions'));
    
    document.addEventListener('click', (e) => { 
        if (!e.target.closest('.search-container')) searchResults.style.display = 'none'; 
        if (!e.target.closest('.directions-section')) document.getElementById('endPointSuggestions').style.display = 'none'; 
    });
    
    document.getElementById('setCurrentAsStartBtn').addEventListener('click', () => { 
        if (currentUser?.location?.coordinates) { 
            routeStartCoords = currentUser.location.coordinates; 
            document.getElementById('startPointInput').value = 'موقعي الحالي'; 
        } else { 
            alert('موقعك غير متاح.'); 
        } 
    });
    
    document.getElementById('calculateRouteBtn').addEventListener('click', () => { 
        calculateRoute(routeStartCoords, routeEndCoords); 
        togglePanel(null); 
    });
    
    document.getElementById('clearRouteBtn').addEventListener('click', clearRoute);
    document.getElementById('mapPitch').addEventListener('input', (e) => map.setPitch(e.target.value)); 
    document.getElementById('mapBearing').addEventListener('input', (e) => map.setBearing(e.target.value));
});

// === إضافة ملاحظات النسخة ===
console.log('✅ تطبيق طريق الجنة - تم تحميل جميع الوظائف بنجاح');
console.log('📌 التعديلات المطبقة:');
console.log('   1. ✅ (تم الاستبدال) استبدال منطق البحث العام بالكامل من الكود النصي.');
console.log('   2. ✅ (تم الاستبدال) استبدال دالة عرض المضيفين بالنسخة المباشرة من الكود النصي.');