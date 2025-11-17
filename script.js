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

// المواقع الرئيسية في العراق
const holySites = [];

// اتصال Socket.IO
const socket = io('https://tareeqaljannah-app.onrender.com');

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
        document.querySelector(`.coord-display-icon[data-coords="${friend.location.coordinates.join(',')}"]`).addEventListener('click', (e) => {
            const coords = e.target.dataset.coords.split(',');
            alert(`إحداثيات ${friend.name}:\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`);
        });
    });
}

// ========== وظائف التوجيه والبحث ==========

// 1. البحث العالمي عبر Geocoding API
async function searchPlaces(query) {
    if (!query || query.length < 2) return [];
    try {
        const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
            `access_token=${mapboxgl.accessToken}&` +
            `language=ar&` +
            `country=iq&` +
            `limit=5`
        );
        const data = await response.json();
        return data.features || [];
    } catch (error) {
        console.error('خطأ في البحث العالمي:', error);
        return [];
    }
}

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
    const foundNames = new Set();

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
        
        if (featureName && !foundNames.has(featureName)) {
            foundNames.add(featureName);
            
            // الحصول على إحداثيات الميزة
            let coordinates = [];
            
            if (feature.geometry.type === 'Point') {
                coordinates = feature.geometry.coordinates;
            } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon') {
                // للمسارات والمناطق، نأخذ المركز التقريبي
                const extent = mapboxgl.LngLatBounds.fromLngLat(feature.geometry.coordinates.flat());
                coordinates = extent.getCenter().toArray();
            }
            
            if (coordinates.length === 2) {
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
            `geometries=geojson&language=ar&overview=full&access_token=${mapboxgl.accessToken}`
        );
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const routeGeometry = route.geometry;
            const distance = (route.distance / 1000).toFixed(2);
            const duration = (route.duration / 60).toFixed(0);
            clearRoute();
            currentRouteLayerId = 'route-' + Date.now();
            map.addSource(currentRouteLayerId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: routeGeometry } });
            map.addLayer({ id: currentRouteLayerId, type: 'line', source: currentRouteLayerId, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#007bff', 'line-width': 8, 'line-opacity': 0.8 } });
            if (!startPointMarker) {
                startPointMarker = new mapboxgl.Marker({ color: '#00FF00' }).setLngLat(start).setPopup(new mapboxgl.Popup().setHTML('<h4>نقطة البداية</h4>')).addTo(map);
            }
            if (!endPointMarker) {
                endPointMarker = new mapboxgl.Marker({ color: '#FF0000' }).setLngLat(end).setPopup(new mapboxgl.Popup().setHTML('<h4>نقطة الوصول</h4>')).addTo(map);
            }
            document.getElementById('routeInfo').style.display = 'block';
            document.getElementById('routeDistance').textContent = `${distance} كم`;
            document.getElementById('routeDuration').textContent = `${duration} دقيقة`;
            const routeInfoBar = document.getElementById('route-info-bar');
            routeInfoBar.innerHTML = `<span><i class="fas fa-route"></i> ${distance} كم</span><span><i class="fas fa-clock"></i> ${duration} دقيقة</span>`;
            routeInfoBar.classList.add('active');
            const bounds = new mapboxgl.LngLatBounds();
            routeGeometry.coordinates.forEach(coord => bounds.extend(coord));
            map.fitBounds(bounds, { padding: 80 });
        } else {
            alert('لم يتم العثور على مسار');
        }
    } catch (error) {
        console.error('خطأ في حساب المسار:', error);
        alert('حدث خطأ أثناء حساب المسار');
    }
}

// مسح المسار
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

    const popupHTML = `
        <h3>
            ${poi.name}
            <i class="fas fa-question-circle coord-display-icon" data-coords="${poi.location.coordinates.join(',')}" title="عرض الإحداثيات"></i>
        </h3>
        <p>${poi.description || 'لا يوجد وصف'}</p>
        <p><strong>الفئة:</strong> ${poi.category}</p>
        ${currentUser && poi.createdBy === currentUser.userId ?
            `<button class="delete-poi-btn" data-poi-id="${poi._id}">
                <i class="fas fa-trash"></i> حذف
            </button>` : ''}
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(poi.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(popupHTML))
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
            const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${poi.location.coordinates.join(',')}"]`);
            if (coordIcon) {
                coordIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const coords = e.target.dataset.coords.split(',');
                    alert(`إحداثيات "${poi.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`);
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

    const popupHTML = `
        <h3>
            نقطة تجمع: ${point.name}
            <i class="fas fa-question-circle coord-display-icon" data-coords="${point.location.coordinates.join(',')}" title="عرض الإحداثيات"></i>
        </h3>
        <p>أنشأها: ${creatorName}</p>
        ${point.expiresAt ? `<p><i class="fas fa-clock"></i> تنتهي في: ${new Date(point.expiresAt).toLocaleString()}</p>` : ''}
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(point.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 40 }).setHTML(popupHTML))
        .addTo(map);

    marker.getPopup().on('open', () => {
        const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${point.location.coordinates.join(',')}"]`);
        if (coordIcon) {
            coordIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                const coords = e.target.dataset.coords.split(',');
                alert(`إحداثيات "${point.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`);
            });
        }
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

    const popupHTML = `
        <h3>
            ${moazeb.name}
             <i class="fas fa-question-circle coord-display-icon" data-coords="${moazeb.location.coordinates.join(',')}" title="عرض الإحداثيات"></i>
        </h3>
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
        <button class="locate-moazeb-btn" data-moazeb-id="${moazeb._id}">
            <i class="fas fa-map-marker-alt"></i> تحديد الموقع
        </button>
    `;

    const marker = new mapboxgl.Marker(el)
        .setLngLat(moazeb.location.coordinates)
        .setPopup(new mapboxgl.Popup({ offset: 30 }).setHTML(popupHTML))
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

            const locateBtn = document.querySelector(`.locate-moazeb-btn[data-moazeb-id="${moazeb._id}"]`);
            if (locateBtn) {
                locateBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    map.flyTo({
                        center: moazeb.location.coordinates,
                        zoom: 15,
                        pitch: 45,
                        bearing: -17.6
                    });
                });
            }

            const coordIcon = document.querySelector(`.coord-display-icon[data-coords="${moazeb.location.coordinates.join(',')}"]`);
            if (coordIcon) {
                coordIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const coords = e.target.dataset.coords.split(',');
                    alert(`إحداثيات "${moazeb.name}":\nخط الطول: ${coords[0]}\nخط العرض: ${coords[1]}`);
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
        data: {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: connectionLine
            }
        }
    });

    map.addLayer({
        id: moazebConnectionLayerId,
        type: 'line',
        source: moazebConnectionLayerId,
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#FFA500',
            'line-width': 4,
            'line-dasharray': [2, 2]
        }
    });
}

function clearAllDynamicMarkers() {
    Object.values(poiMarkers).forEach(marker => marker.remove());
    Object.keys(poiMarkers).forEach(key => delete poiMarkers[key]);

    Object.values(moazebMarkers).forEach(marker => marker.remove());
    Object.keys(moazebMarkers).forEach(key => delete moazebMarkers[key]);

    clearHistoricalPath();

    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
        moazebConnectionLayerId = null;
    }
}

function showGeneralMap() {
    linkedFriends.forEach(friend => {
        const layerId = `route-${currentUser.userId}-${friend.userId}`;
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(layerId)) {
            map.removeSource(layerId);
        }
    });

    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    clearAllDynamicMarkers();

    socket.emit('requestPOIs');

    map.flyTo({
        center: [43.6875, 33.3152],
        zoom: 6,
        pitch: 45,
        bearing: -17.6
    });
}

// نسخة محسنة من showFriendsMap
async function showFriendsMap() {
    clearAllDynamicMarkers();

    Object.values(friendMarkers).forEach(marker => marker.remove());
    Object.keys(friendMarkers).forEach(key => delete friendMarkers[key]);

    if (currentUser?.linkedFriends) {
        currentUser.linkedFriends.forEach(friendId => {
            const layerId = `route-${currentUser.userId}-${friendId}`;
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(layerId)) map.removeSource(layerId);
        });
    }

    const bounds = new mapboxgl.LngLatBounds();
    const visibleUsers = [];

    // إضافة المستخدم الحالي إذا كان مشاركًا لموقعه
    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        createCustomMarker(currentUser);
        visibleUsers.push(currentUser);
        bounds.extend(currentUser.location.coordinates);
    }

    // إضافة الأصدقاء المرتبطين
    linkedFriends.forEach(friend => {
        if (friend?.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
            createCustomMarker(friend);
            visibleUsers.push(friend);
            bounds.extend(friend.location.coordinates);

            // إضافة نقاط التجمع للأصدقاء
            if (friend.meetingPoint?.location?.coordinates) {
                createMeetingPointMarker({
                    creatorId: friend.userId,
                    creatorName: friend.name,
                    point: friend.meetingPoint
                });
            }
        }
    });

    // رسم المسارات بين المستخدم الحالي وأصدقائه
    const routePromises = [];
    if (currentUser?.location?.coordinates && currentUser.settings.shareLocation && !currentUser.settings.stealthMode) {
        linkedFriends.forEach(friend => {
            if (friend?.location?.coordinates && friend.settings.shareLocation && !friend.settings.stealthMode) {
                const layerId = `route-${currentUser.userId}-${friend.userId}`;
                routePromises.push(drawRoadRouteBetweenPoints(currentUser.location.coordinates, friend.location.coordinates, layerId));
            }
        });
    }

    // انتظار اكتمال جميع وعود رسم المسارات
    try {
        const routeGeometries = await Promise.all(routePromises);
        
        // توسيع الحدود لتشمل جميع المسارات
        routeGeometries.forEach(geometry => {
            if (geometry) {
                geometry.coordinates.forEach(coord => bounds.extend(coord));
            }
        });

        // ضبط عرض الخريطة
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { 
                padding: 80, 
                pitch: 45, 
                bearing: -17.6, 
                maxZoom: 15,
                duration: 1000 // إضافة حركة سلسة
            });
        } else if (visibleUsers.length === 1) {
            map.flyTo({ 
                center: visibleUsers[0].location.coordinates, 
                zoom: 14, 
                pitch: 45, 
                bearing: -17.6,
                duration: 1000
            });
        } else {
            map.flyTo({ 
                center: [43.6875, 33.3152], 
                zoom: 6,
                duration: 1000
            });
        }
    } catch (error) {
        console.error('خطأ في عرض خريطة الأصدقاء:', error);
    }
}

function showAllMoazebOnMap() {
    socket.emit('getAllMoazeb');
}

async function drawRoadRouteBetweenPoints(startCoords, endCoords, layerId) {
    if (!startCoords || !endCoords) return null;

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(layerId)) map.removeSource(layerId);

    try {
        const response = await fetch(
            `https://api.mapbox.com/directions/v5/mapbox/driving/${startCoords.join(',')};${endCoords.join(',')}?` +
            `geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`
        );
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const routeGeometry = data.routes[0].geometry;

            map.addSource(layerId, {
                'type': 'geojson',
                'data': {
                    'type': 'Feature',
                    'properties': {},
                    'geometry': routeGeometry
                }
            });

            map.addLayer({
                'id': layerId,
                'type': 'line',
                'source': layerId,
                'layout': { 'line-join': 'round', 'line-cap': 'round' },
                'paint': { 'line-color': '#007bff', 'line-width': 4, 'line-dasharray': [0.5, 2] }
            });

            return routeGeometry;
        }
    } catch (error) {
        console.error(`خطأ في رسم المسار ${layerId}:`, error);
    }
    return null;
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

// نظام تحديد المواقع (GPS)
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
            return (battery.level * 100).toFixed(0) + '%';
        } catch (e) {
            console.error("خطأ في جلب حالة البطارية:", e);
            return 'N/A';
        }
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

function playProximitySound() {
    if (currentUser && currentUser.settings.sound && !proximityAlertPlayed) {
        const audio = new Audio('https://www.soundjay.com/mechanical/sounds/car-horn-01.mp3');
        audio.play().catch(e => console.error("Error playing sound:", e));
        proximityAlertPlayed = true;
        setTimeout(() => { proximityAlertPlayed = false; }, 30000);
    }
}

function playPrayerSound() {
    if (currentUser && currentUser.settings.sound && !prayerAlertPlayed) {
        const audio = new Audio('https://www.soundjay.com/religious/sounds/adhan-azan-01.mp3');
        audio.play().catch(e => console.error("Error playing sound:", e));
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

    if (Math.abs(currentTime - prayerMinutes) < 5) {
        playPrayerSound();
    }
}

function sendMessageFromBottomBar() {
    const bottomChatInput = document.getElementById('bottomChatInput');
    const messageText = bottomChatInput.value.trim();
    if (!currentUser) {
        alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
        return;
    }
    if (!currentChatFriendId) {
        alert("الرجاء اختيار صديق من القائمة للدردشة معه.");
        return;
    }
    if (messageText) {
        if (document.getElementById('chatPanel').classList.contains('active')) {
            addChatMessage(currentUser.name, messageText, 'sent', new Date());
        }
        socket.emit('chatMessage', {
            senderId: currentUser.userId,
            receiverId: currentChatFriendId,
            message: messageText
        });
        if (currentUser.settings.sound) playNotificationSound();
        if (!currentUser.settings.hideBubbles) showMessageBubble(currentUser.userId, messageText);
        bottomChatInput.value = '';
    } else {
        alert("الرسالة فارغة.");
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
        }, 30000);
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

function toggleAllMarkers(show = true) {
    const displayStyle = show ? 'flex' : 'none';
    const markerCollections = [friendMarkers, poiMarkers, meetingPointMarkers, moazebMarkers];
    markerCollections.forEach(collection => {
        Object.values(collection).forEach(marker => {
            if (marker && typeof marker.getElement === 'function') {
                marker.getElement().style.display = displayStyle;
            }
        });
    });
}

function captureMap() {
    const altitude = map.getFreeCameraOptions().position.altitude;
    const canvas = map.getCanvas();
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    tempCtx.drawImage(canvas, 0, 0);

    tempCtx.font = "bold 24px Cairo";
    tempCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
    tempCtx.fillRect(10, tempCanvas.height - 50, 280, 40);
    tempCtx.fillStyle = "white";
    tempCtx.textAlign = "right";
    tempCtx.fillText(`ارتفاع الكاميرا: ${altitude.toFixed(0)} متر`, 280, tempCanvas.height - 20);

    const dataURL = tempCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `tareeq_aljannah_map_${new Date().toISOString()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    rotateBtn.innerHTML = '<i class="fas fa-compass"></i>';
    rotateBtn.title = 'إعادة توجيه الخريطة';
    rotateBtn.addEventListener('click', () => map.resetNorthPitch());

    const toggleHeaderBtn = document.createElement('button');
    toggleHeaderBtn.className = 'map-control-btn';
    toggleHeaderBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    toggleHeaderBtn.title = 'إخفاء/إظهار الشريط العلوي';
    toggleHeaderBtn.addEventListener('click', () => {
        document.body.classList.toggle('header-hidden');
        setTimeout(() => map.resize(), 300);
    });

    const captureBtn = document.createElement('button');
    captureBtn.className = 'map-control-btn';
    captureBtn.innerHTML = '<i class="fas fa-camera"></i>';
    captureBtn.title = 'التقاط صورة للخريطة';
    captureBtn.addEventListener('click', captureMap);

    const styleSwitcherBtn = document.createElement('button');
    styleSwitcherBtn.className = 'map-control-btn';
    styleSwitcherBtn.innerHTML = '<i class="fas fa-layer-group"></i>';
    styleSwitcherBtn.title = 'تغيير نمط الخريطة';

    const styleSwitcherContainer = document.createElement('div');
    styleSwitcherContainer.id = 'map-style-switcher';

    const styles = [
        { name: 'شوارع', id: 'mapbox://styles/mapbox/streets-v11' },
        { name: 'قمر صناعي', id: 'mapbox://styles/mapbox/satellite-streets-v12' },
        { name: 'تضاريس', id: 'mapbox://styles/mapbox/outdoors-v12' }
    ];

    styles.forEach(style => {
        const btn = document.createElement('button');
        btn.className = 'style-btn';
        btn.textContent = style.name;
        btn.dataset.styleId = style.id;
        if (map.getStyle().sprite.includes(style.id)) btn.classList.add('active');

        btn.addEventListener('click', () => {
            map.setStyle(style.id);
            document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
        styleSwitcherContainer.appendChild(btn);
    });

    styleSwitcherBtn.addEventListener('click', () => {
        styleSwitcherContainer.classList.toggle('active');
    });

    controlsDiv.appendChild(zoomInBtn);
    controlsDiv.appendChild(zoomOutBtn);
    controlsDiv.appendChild(rotateBtn);
    controlsDiv.appendChild(toggleHeaderBtn);
    controlsDiv.appendChild(captureBtn);
    controlsDiv.appendChild(styleSwitcherBtn);
    controlsDiv.appendChild(styleSwitcherContainer);

    document.getElementById('map').appendChild(controlsDiv);
}

function updateFriendsPanelList() {
    const friendsListEl = document.getElementById('friendsList');
    if (!friendsListEl) return;

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

// إضافة وظيفة مساعدة للتأكد من تحديث بيانات الأصدقاء
function refreshFriendsData() {
    if (currentUser && currentUser.linkedFriends && currentUser.linkedFriends.length > 0) {
        socket.emit('requestFriendsData', { friendIds: currentUser.linkedFriends });
    }
}

// التعامل مع أحداث WebSocket من الخادم
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
    let userToUpdate;
    if (currentUser && data.userId === currentUser.userId) {
        userToUpdate = currentUser;
    } else {
        userToUpdate = linkedFriends.find(f => f.userId === data.userId);
    }

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

        if (currentUser && currentUser.location && currentUser.location.coordinates &&
            userToUpdate.userId !== currentUser.userId &&
            userToUpdate.location && userToUpdate.location.coordinates) {

            const distance = calculateDistance(
                currentUser.location.coordinates[1], currentUser.location.coordinates[0],
                userToUpdate.location.coordinates[1], userToUpdate.location.coordinates[0]
            );

            if (distance < 1) {
                playProximitySound();
            }
        }

        if (isFriendsMapActive && currentUser && currentUser.userId !== userToUpdate.userId && shouldBeVisible) {
            const currentUserIsVisible = currentUser.settings.shareLocation && !currentUser.settings.stealthMode;
            if (currentUserIsVisible && currentUser.location && currentUser.location.coordinates) {
                const layerId = `route-${currentUser.userId}-${userToUpdate.userId}`;
                drawRoadRouteBetweenPoints(currentUser.location.coordinates, userToUpdate.location.coordinates, layerId);
            }
        }
    }
});

socket.on('linkStatus', (data) => {
    alert(data.message);
    if (data.success) {
        socket.emit('registerUser', { userId: currentUser.userId });
        setupBottomChatBar();
        const friendsButton = document.getElementById('showFriendsMapBtn');
        if (friendsButton) {
            friendsButton.click();
        }
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
        updateFriendsPanelList();
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

    const layerId = `route-${currentUser.userId}-${data.userId}`;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(layerId)) map.removeSource(layerId);

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

socket.on('newPOIAdded', (poi) => {
    createPOIMarker(poi);
});

socket.on('poiDeletedBroadcast', (data) => {
    if (poiMarkers[data.poiId]) {
        poiMarkers[data.poiId].remove();
        delete poiMarkers[data.poiId];
    }
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
            alert(`لا توجد بيانات مسار تاريخي.`);
        }
    } else {
        alert(`فشل جلب المسار التاريخي: ${data.message}`);
    }
});

socket.on('chatHistoryData', (data) => {
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (!chatMessagesDiv) return;
    chatMessagesDiv.innerHTML = '';
    if (data.success && data.history && data.history.length > 0) {
        data.history.forEach(msg => {
            const messageType = (msg.senderId === currentUser.userId) ? 'sent' : 'received';
            const senderName = (msg.senderId === currentUser.userId) ? currentUser.name : linkedFriends.find(f => f.userId === msg.senderId)?.name || 'صديق';
            addChatMessage(senderName, msg.message, messageType, msg.timestamp);
        });
    } else {
        chatMessagesDiv.innerHTML = '<p style="text-align: center; color: #777;">لا توجد رسائل سابقة في هذه المحادثة.</p>';
    }
});

socket.on('newMeetingPoint', (data) => {
    createMeetingPointMarker(data);
    if (currentUser && data.creatorId === currentUser.userId) {
        document.getElementById('endMeetingPointBtn').style.display = 'block';
        updateMyCreationsList();
    }
});

socket.on('meetingPointCleared', (data) => {
    if (meetingPointMarkers[data.creatorId]) {
        meetingPointMarkers[data.creatorId].remove();
        delete meetingPointMarkers[data.creatorId];
        if (data.creatorId !== currentUser.userId) {
            alert('تم إنهاء نقطة التجمع.');
        }
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
        document.getElementById('addMoazebName').value = '';
        document.getElementById('addMoazebAddress').value = '';
        document.getElementById('addMoazebPhone').value = '';
        document.getElementById('addMoazebGov').value = '';
        document.getElementById('addMoazebDist').value = '';
    }
});

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
                <button class="link-to-moazeb-btn" data-moazeb-id="${moazeb._id}">
                    <i class="fas fa-link"></i> الربط بالمضيف
                </button>
                <button class="locate-moazeb-btn" data-moazeb-id="${moazeb._id}">
                    <i class="fas fa-map-marker-alt"></i> تحديد الموقع
                </button>
            `;
            resultsContainer.appendChild(card);

            card.querySelector('.link-to-moazeb-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`هل تريد الربط مع المضيف ${moazeb.name}؟`)) {
                    socket.emit('linkToMoazeb', { moazebId: moazeb._id });
                }
            });

            card.querySelector('.locate-moazeb-btn').addEventListener('click', (e) => {
                e.stopPropagation();

                map.flyTo({
                    center: moazeb.location.coordinates,
                    zoom: 15,
                    pitch: 45,
                    bearing: -17.6
                });

                togglePanel(null);

                document.getElementById('showGeneralMapBtn').classList.add('active');
            });

            createMoazebMarker(moazeb);
        });
        const bounds = new mapboxgl.LngLatBounds();
        data.results.forEach(m => bounds.extend(m.location.coordinates));
        map.fitBounds(bounds, { padding: 50 });

    } else {
        resultsContainer.innerHTML = '<p class="feature-info">لا توجد نتائج تطابق بحثك.</p>';
    }
});

socket.on('allMoazebData', (data) => {
    if (data.success && data.moazebs) {
        Object.values(moazebMarkers).forEach(m => m.remove());
        Object.keys(moazebMarkers).forEach(k => delete moazebMarkers[k]);

        data.moazebs.forEach(moazeb => {
            createMoazebMarker(moazeb);
        });

        if (data.moazebs.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            data.moazebs.forEach(m => bounds.extend(m.location.coordinates));
            map.fitBounds(bounds, { padding: 50 });
        }
    }
});

socket.on('linkToMoazebStatus', (data) => {
    alert(data.message);
    if (data.success) {
        if (data.connectionLine && data.connectionLine.length > 0) {
            drawMoazebConnectionLine(data.connectionLine);
        }
        socket.emit('registerUser', { userId: currentUser.userId });
    }
});

socket.on('moazebConnectionData', (data) => {
    if (data.connectionLine && data.connectionLine.length > 0) {
        drawMoazebConnectionLine(data.connectionLine);
    }
});

socket.on('moazebConnectionUpdate', (data) => {
    if (data.connectionLine && data.connectionLine.length > 0) {
        drawMoazebConnectionLine(data.connectionLine);
    }
});

socket.on('moazebConnectionRemoved', () => {
    if (moazebConnectionLayerId && map.getLayer(moazebConnectionLayerId)) {
        map.removeLayer(moazebConnectionLayerId);
        map.removeSource(moazebConnectionLayerId);
        moazebConnectionLayerId = null;
    }
});

socket.on('poiDeleted', (data) => {
    if (data.success) {
        if (poiMarkers[data.poiId]) {
            poiMarkers[data.poiId].remove();
            delete poiMarkers[data.poiId];
        }
        socket.emit('registerUser', { userId: currentUser.userId });
        alert('تم حذف نقطة الاهتمام بنجاح');
    } else {
        alert(`فشل حذف نقطة الاهتمام: ${data.message}`);
    }
});

socket.on('prayerTimesData', (data) => {
    const displayElement = document.getElementById('prayerTimesDisplay');
    if (data.success) {
        const { Fajr, Dhuhr, Asr, Maghrib, Isha } = data.timings;
        displayElement.innerHTML = `<p><strong>الفجر:</strong> ${Fajr}</p><p><strong>الظهر:</strong> ${Dhuhr}</p><p><strong>العصر:</strong> ${Asr}</p><p><strong>المغرب:</strong> ${Maghrib}</p><p><strong>العشاء:</strong> ${Isha}</p>`;

        checkPrayerTime(Fajr);
        checkPrayerTime(Dhuhr);
        checkPrayerTime(Asr);
        checkPrayerTime(Maghrib);
        checkPrayerTime(Isha);
    } else {
        displayElement.innerHTML = `<p style="color: var(--danger-color);">${data.message || 'فشل جلب أوقات الصلاة.'}</p>`;
    }
});

map.on('load', () => {
    map.setLanguage('ar');
    showGeneralMap();
    document.getElementById('showGeneralMapBtn').classList.add('active');
    setupMapControls();
});

document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('showGeneralMapBtn').addEventListener('click', () => {
        togglePanel(null);
        document.getElementById('showGeneralMapBtn').classList.add('active');
        showGeneralMap();
    });

    document.getElementById('showFriendsMapBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        
        // تحديث بيانات الأصدقاء قبل العرض
        refreshFriendsData();
        
        togglePanel(null);
        document.getElementById('showFriendsMapBtn').classList.add('active');
        showFriendsMap();
        setupBottomChatBar();
    });

    document.getElementById('showAllMoazebBtn').addEventListener('click', () => {
        showAllMoazebOnMap();
    });

    document.getElementById('initialInfoConfirmBtn').addEventListener('click', () => {
        const name = document.getElementById('initialInfoNameInput').value.trim();
        const gender = document.getElementById('initialInfoGenderSelect').value;
        const phone = document.getElementById('initialInfoPhoneInput').value.trim();
        const email = document.getElementById('initialInfoEmailInput').value.trim();

        if (name && gender !== 'other' && phone && email) {
            if (!validateEmail(email)) {
                alert('الرجاء إدخال بريد إلكتروني صحيح');
                return;
            }

            localStorage.setItem('appUserName', name);
            localStorage.setItem('appUserGender', gender);
            localStorage.setItem('appUserPhone', phone);
            localStorage.setItem('appUserEmail', email);

            socket.emit('updateSettings', { name, gender, phone, email });
            document.getElementById('initialInfoPanel').classList.remove('active');
            alert('تم حفظ معلوماتك بنجاح.');
        } else {
            alert('الرجاء ملء جميع الحقول المطلوبة.');
        }
    });

    function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(String(email).toLowerCase());
    }

    document.getElementById('showProfileBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        updateMyCreationsList();
        togglePanel('profilePanel');
    });

    document.getElementById('generateCodeBtn').addEventListener('click', () => {
        alert('طلب رمز ربط جديد غير متاح حالياً.');
    });

    document.getElementById('copyLinkCodeBtn').addEventListener('click', () => {
        const linkCode = document.getElementById('userLinkCode').textContent;
        if (linkCode) {
            navigator.clipboard.writeText(linkCode).then(() => {
                alert('تم نسخ رمز الربط إلى الحافظة!');
            }).catch(err => {
                console.error('فشل نسخ رمز الربط:', err);
                alert('فشل نسخ رمز الربط.');
            });
        }
    });

    document.getElementById('updateProfileInfoBtn').addEventListener('click', () => {
        if (!currentUser) return;
        const newName = document.getElementById('editUserNameInput').value.trim();
        const newGender = document.getElementById('editGenderSelect').value;
        const newPhone = document.getElementById('editPhoneInput').value.trim();
        const newEmail = document.getElementById('editEmailInput').value.trim();

        if (newName && newGender !== 'other' && newPhone && newEmail) {
            if (!validateEmail(newEmail)) {
                alert('الرجاء إدخال بريد إلكتروني صحيح');
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

            socket.emit('updateSettings', {
                name: newName,
                gender: newGender,
                phone: newPhone,
                email: newEmail
            });
            alert('تم حفظ معلومات الملف الشخصي بنجاح!');
        } else {
            alert('الرجاء ملء جميع حقول معلومات الملف الشخصي المطلوبة.');
        }
    });

    document.getElementById('showConnectBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        togglePanel('connectPanel');
        updateFriendsPanelList();
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

    document.getElementById('bottomChatSendBtn').addEventListener('click', sendMessageFromBottomBar);
    document.getElementById('bottomChatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessageFromBottomBar();
        }
    });

    document.getElementById('toggleChatHistoryBtn').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        if (linkedFriends.length === 0) {
            alert("الرجاء ربط صديق أولاً لعرض سجل الدردشة.");
            return;
        }
        togglePanel('chatPanel');
        setupChatPanel();
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
        if (selectedUserId) {
            socket.emit('requestHistoricalPath', { targetUserId: selectedUserId, limit: 200 });
        } else {
            alert("الرجاء اختيار مستخدم لعرض مساره.");
        }
    });

    document.getElementById('clearHistoricalPathBtn').addEventListener('click', () => {
        clearHistoricalPath();
        alert('تم مسح المسار التاريخي من الخريطة.');
    });

    const poiCategorySelect = document.getElementById('poiCategorySelect');
    if (poiCategorySelect) {
        const categories = ['Rest Area', 'Medical Post', 'Food Station', 'Water', 'Mosque', 'Parking', 'Info', 'Other'];
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            poiCategorySelect.appendChild(option);
        });
    }

    document.getElementById('addPoiBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            alert("موقعك الحالي غير متاح. يرجى تفعيل GPS والمحاولة مرة أخرى.");
            return;
        }
        const poiName = prompt("أدخل اسم نقطة الاهتمام (مثال: موكب الأنصار):");
        if (poiName) {
            const poiDesc = prompt("أدخل وصفاً لنقطة الاهتمام (اختياري):");
            const poiCategory = document.getElementById('poiCategorySelect').value;
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
                name: poiName,
                description: poiDesc,
                category: poiCategory,
                location: currentUser.location.coordinates,
                icon: iconMap[poiCategory] || iconMap['Other']
            });
        }
    });

    document.getElementById('whatsappHelpBtn').addEventListener('click', () => {
        const supportNumber = '9647708077310';
        const message = "السلام عليكم، لدي استفسار بخصوص تطبيق طريق الجنة.";
        const whatsappUrl = `https://wa.me/${supportNumber}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    });

    document.getElementById('sosButton').addEventListener('click', () => {
        if (!currentUser) {
            alert("جاري تحميل بيانات المستخدم. يرجى المحاولة مرة أخرى.");
            return;
        }
        const emergencyWhatsapp = currentUser.settings.emergencyWhatsapp;
        if (!emergencyWhatsapp || emergencyWhatsapp.length < 5) {
            alert("الرجاء إضافة رقم واتساب للطوارئ في الإعدادات أولاً.");
            return;
        }

        if (confirm("هل أنت متأكد من رغبتك في إرسال إشارة استغاثة (SOS)؟ سيتم إرسال رسالة واتساب إلى رقم الطوارئ الخاص بك وموقعك الجغرافي.")) {
            if (currentUser.settings.sound) {
                playSOSSound();
            }

            let message = "مساعدة عاجلة! أنا بحاجة للمساعدة.\n";
            if (currentUser.location && currentUser.location.coordinates) {
                const [lng, lat] = currentUser.location.coordinates;
                message += `موقعي الحالي: https://www.google.com/maps?q=${lat},${lng}\n`;
            } else {
                message += "موقعي غير متاح حالياً.";
            }
            message += `\nمن تطبيق طريق الجنة - ${currentUser.name}`;

            const whatsappUrl = `https://wa.me/${emergencyWhatsapp}?text=${encodeURIComponent(message)}`;
            window.open(whatsappUrl, '_blank');

            alert("تم فتح واتساب لإرسال رسالة SOS.");
        }
    });

    document.getElementById('refreshPrayerTimesBtn').addEventListener('click', fetchAndDisplayPrayerTimes);

    document.getElementById('setMeetingPointBtn').addEventListener('click', () => {
        const meetingPointName = document.getElementById('meetingPointInput').value.trim();

        if (!currentUser || !currentUser.location || !currentUser.location.coordinates || (currentUser.location.coordinates[0] === 0 || currentUser.location.coordinates[1] === 0)) {
            alert("لا يمكن تحديد نقطة تجمع بدون تحديد موقعك الحالي أولاً.");
            return;
        }
        if (meetingPointName) {
            socket.emit('setMeetingPoint', { name: meetingPointName, location: currentUser.location.coordinates });
        } else {
            alert("الرجاء إدخال اسم لنقطة التجمع.");
        }
    });

    document.getElementById('endMeetingPointBtn').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إنهاء نقطة التجمع الحالية؟')) {
            socket.emit('clearMeetingPoint');
        }
    });

    document.getElementById('showMoazebBtn').addEventListener('click', () => {
        togglePanel('moazebPanel');
    });

    document.getElementById('addMoazebBtn').addEventListener('click', () => {
        if (!currentUser || !currentUser.location || !currentUser.location.coordinates || (currentUser.location.coordinates[0] === 0 && currentUser.location.coordinates[1] === 0)) {
            alert("موقعك الحالي غير متاح. يرجى تفعيل GPS والمحاولة مرة أخرى.");
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
            alert('الرجاء ملء جميع حقول المضيف.');
            return;
        }
        if (!/^07\d{9}$/.test(data.phone)) {
            alert('رقم الهاتف يجب أن يبدأ بـ 07 ويتكون من 11 رقماً');
            return;
        }
        socket.emit('addMoazeb', data);
    });

    document.getElementById('searchMoazebBtn').addEventListener('click', () => {
        const query = {
            phone: document.getElementById('searchMoazebPhone').value.trim(),
            governorate: document.getElementById('searchMoazebGov').value.trim(),
            district: document.getElementById('searchMoazebDist').value.trim()
        };
        if (!query.phone && !query.governorate && !query.district) {
            alert('الرجاء إدخال معيار واحد على الأقل للبحث.');
            return;
        }
        socket.emit('searchMoazeb', query);
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
        if (document.getElementById('emergencyWhatsappInput')) {
            document.getElementById('emergencyWhatsappInput').value = currentUser.settings.emergencyWhatsapp || '';
        }
        if (document.getElementById('showPhoneToggle')) {
            document.getElementById('showPhoneToggle').checked = currentUser.settings.showPhone;
        }
        if (document.getElementById('showEmailToggle')) {
            document.getElementById('showEmailToggle').checked = currentUser.settings.showEmail;
        }
    });

    document.getElementById('shareLocationToggle').addEventListener('change', (e) => {
        if (currentUser) socket.emit('updateSettings', { shareLocation: e.target.checked });
    });

    document.getElementById('soundToggle').addEventListener('change', (e) => {
        if (currentUser) {
            currentUser.settings.sound = e.target.checked;
            socket.emit('updateSettings', { sound: e.target.checked });
        }
    });

    document.getElementById('hideBubblesToggle').addEventListener('change', (e) => {
        if (currentUser) socket.emit('updateSettings', { hideBubbles: e.target.checked });
    });

    document.getElementById('stealthModeToggle').addEventListener('change', (e) => {
        if (currentUser) socket.emit('updateSettings', { stealthMode: e.target.checked });
    });

    document.getElementById('showPhoneToggle').addEventListener('change', (e) => {
        if (currentUser) socket.emit('updateSettings', { showPhone: e.target.checked });
    });

    document.getElementById('showEmailToggle').addEventListener('change', (e) => {
        if (currentUser) socket.emit('updateSettings', { showEmail: e.target.checked });
    });

    document.getElementById('updateEmergencyWhatsappBtn').addEventListener('click', () => {
        if (!currentUser) return;
        const newWhatsapp = document.getElementById('emergencyWhatsappInput').value.trim();
        if (newWhatsapp) {
            currentUser.settings.emergencyWhatsapp = newWhatsapp;
            localStorage.setItem('appEmergencyWhatsapp', newWhatsapp);
            socket.emit('updateSettings', { emergencyWhatsapp: newWhatsapp });
            alert('تم حفظ رقم الواتساب للطوارئ بنجاح!');
        } else {
            alert('الرجاء إدخال رقم واتساب صحيح.');
        }
    });

    document.getElementById('showDirectionsBtn').addEventListener('click', () => {
        togglePanel('directionsPanel');
    });

    // 4. الربط بين حقول البحث والدالة الشاملة
    const mapSearchInput = document.getElementById('mapSearchInput');
    const searchResults = document.getElementById('searchResults');
    const endPointInput = document.getElementById('endPointInput');

    async function handleSearchInput(e, resultsContainerId) {
        const query = e.target.value;
        const resultsContainer = document.getElementById(resultsContainerId);
        
        if (query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        // استدعاء البحث العالمي والمحلي بالتوازي
        const [globalResults, localResults] = await Promise.all([
            searchPlaces(query),
            searchVisibleFeatures(query)
        ]);
        
        // دمج النتائج مع إزالة التكرار
        const combinedResults = [...globalResults];
        const existingPlaceNames = new Set(globalResults.map(r => r.place_name_ar || r.place_name));

        localResults.forEach(localResult => {
            if (!existingPlaceNames.has(localResult.place_name_ar)) {
                combinedResults.push(localResult);
            }
        });

        displaySearchResults(combinedResults, resultsContainerId);
    }

    mapSearchInput.addEventListener('input', (e) => handleSearchInput(e, 'searchResults'));
    endPointInput.addEventListener('input', (e) => handleSearchInput(e, 'endPointSuggestions'));

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.style.display = 'none';
        }
        if (!e.target.closest('.directions-section')) {
            document.getElementById('endPointSuggestions').style.display = 'none';
        }
    });

    document.getElementById('setCurrentAsStartBtn').addEventListener('click', () => {
        if (currentUser && currentUser.location && currentUser.location.coordinates) {
            routeStartCoords = currentUser.location.coordinates;
            document.getElementById('startPointInput').value = 'موقعي الحالي';
        } else {
            alert('موقعك الحالي غير متاح');
        }
    });

    document.getElementById('calculateRouteBtn').addEventListener('click', () => {
        calculateRoute(routeStartCoords, routeEndCoords);
        togglePanel(null);
        document.getElementById('showGeneralMapBtn').classList.add('active');
    });

    document.getElementById('clearRouteBtn').addEventListener('click', () => {
        clearRoute();
    });

    const mapPitchInput = document.getElementById('mapPitch');
    const mapBearingInput = document.getElementById('mapBearing');
    if (mapPitchInput && mapBearingInput) {
        mapPitchInput.addEventListener('input', (e) => {
            map.setPitch(e.target.value);
        });
        mapBearingInput.addEventListener('input', (e) => {
            map.setBearing(e.target.value);
        });
    }

    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    async function performSearch() {
        const query = searchInput.value.trim();
        if (!query) return;

        const results = await searchPlaces(query);

        if (results && results.length > 0) {
            const result = results[0];
            const coordinates = result.center;

            map.flyTo({
                center: coordinates,
                zoom: 14
            });

            if (searchResultMarker) {
                searchResultMarker.remove();
            }

            const el = document.createElement('div');
            el.className = 'search-result-marker';

            searchResultMarker = new mapboxgl.Marker(el)
                .setLngLat(coordinates)
                .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(result.place_name_ar || result.place_name))
                .addTo(map);

            toggleAllMarkers(false);
            clearSearchBtn.style.display = 'block';

        } else {
            alert('لم يتم العثور على نتائج للبحث.');
        }
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (searchResultMarker) {
                searchResultMarker.remove();
                searchResultMarker = null;
            }
            if (searchInput) searchInput.value = '';
            toggleAllMarkers(true);
            clearSearchBtn.style.display = 'none';
        });
    }
});