// Great-circle distance in metres. The SQL function haversine_m in
// supabase/schema.sql uses the same formula and the same Earth radius.
const EARTH_RADIUS_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export function getPosition(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('no_geolocation'), { code: 'no_geolocation' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        isMocked: Boolean(pos.coords.isMocked || pos.coords.mocked),
      }),
      (err) => {
        const code = err.code === 1 ? 'gps_denied' : 'gps_unavailable';
        reject(Object.assign(new Error(code), { code }));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
