// Coordinates roughly following a drive from Santa Monica Pier to Boston Pleasure Bay
const routeCoords = [
    [34.0095, -118.4973], // Santa Monica Pier
    [36.1699, -115.1398], // Las Vegas
    [39.7392, -104.9903], // Denver
    [41.2565, -95.9345],  // Omaha
    [41.8781, -87.6298],  // Chicago
    [41.4993, -81.6944],  // Cleveland
    [42.8864, -78.8784],  // Buffalo
    [42.6526, -73.7562],  // Albany
    [42.3369, -71.0351]   // Boston Pleasure Bay
];

// Haversine distance in miles
function haversine(a, b) {
    const toRad = deg => deg * Math.PI / 180;
    const R = 3958.8; // Earth radius in miles
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function totalDistance(coords) {
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        dist += haversine(coords[i], coords[i+1]);
    }
    return dist;
}

const ROUTE_DISTANCE_MILES = totalDistance(routeCoords);

function pointAtDistance(coords, distance) {
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const seg = haversine(coords[i], coords[i+1]);
        if (dist + seg >= distance) {
            const ratio = (distance - dist) / seg;
            return [
                coords[i][0] + (coords[i+1][0] - coords[i][0]) * ratio,
                coords[i][1] + (coords[i+1][1] - coords[i][1]) * ratio
            ];
        }
        dist += seg;
    }
    return coords[coords.length - 1];
}

const map = L.map('map').setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const routeLine = L.polyline(routeCoords, {color: 'blue'}).addTo(map);
map.fitBounds(routeLine.getBounds());

const markersGroup = L.layerGroup().addTo(map);

function updateMap(netWorth) {
    markersGroup.clearLayers();
    const fraction = netWorth / 1_000_000_000;
    const dist = ROUTE_DISTANCE_MILES * fraction;
    const point = pointAtDistance(routeCoords, dist);
    L.marker(point).addTo(markersGroup).bindPopup(`Your position: ${dist.toFixed(2)} miles`);
    document.getElementById('result').textContent = `You would travel ${dist.toFixed(2)} miles out of ${ROUTE_DISTANCE_MILES.toFixed(0)} miles.`;

    // Benchmarks
    const benchmarks = [
        {name: '$1M', value: 1_000_000},
        {name: '$10M', value: 10_000_000},
        {name: '$50M', value: 50_000_000},
        {name: '$100M', value: 100_000_000},
        {name: '$500M', value: 500_000_000},
        {name: '$1B', value: 1_000_000_000}
    ];
    benchmarks.forEach(b => {
        const bDist = ROUTE_DISTANCE_MILES * (b.value / 1_000_000_000);
        const bPoint = pointAtDistance(routeCoords, bDist);
        L.circleMarker(bPoint, {radius:4, color:'red'}).addTo(markersGroup)
            .bindPopup(`${b.name} (${bDist.toFixed(1)} mi)`);
    });
}

document.getElementById('showBtn').addEventListener('click', () => {
    const value = Number(document.getElementById('netWorth').value);
    if (isNaN(value) || value <= 0) {
        alert('Please enter a positive number');
        return;
    }
    updateMap(value);
});
