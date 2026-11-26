const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two { latitude, longitude } points. */
const haversineMeters = (a, b) => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Google Maps link for a coordinate (used later by the SOS SMS). */
const googleMapsLink = (latitude, longitude) =>
  `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;

module.exports = {
  haversineMeters,
  googleMapsLink,
};
