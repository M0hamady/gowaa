const MAX_IMAGES = 10;
const EGYPT_BOUNDS = { south: 21.5, north: 31.9, west: 24.5, east: 36.9 };

export function validateProject(project) {
  if (!project || typeof project !== 'object') throw new TypeError('بيانات المشروع غير صحيحة.');
  if (!String(project.id || '').trim()) throw new TypeError('معرّف المشروع مطلوب.');
  if (!String(project.title || '').trim()) throw new TypeError('اسم المشروع مطلوب.');
  if (!Number.isFinite(Number(project.lat)) || !Number.isFinite(Number(project.lng))) {
    throw new TypeError('موقع المشروع مطلوب.');
  }
  const lat = Number(project.lat), lng = Number(project.lng);
  if (lat < EGYPT_BOUNDS.south || lat > EGYPT_BOUNDS.north || lng < EGYPT_BOUNDS.west || lng > EGYPT_BOUNDS.east) {
    throw new RangeError('موقع المشروع لازم يكون داخل حدود مصر.');
  }
  const images = Array.isArray(project.images) ? project.images : [];
  if (images.length > MAX_IMAGES) throw new RangeError('الحد الأقصى 10 صور لكل مشروع.');
  if (images.some(src => typeof src !== 'string' || !/^https:\/\//i.test(src))) {
    throw new TypeError('كل صورة لازم تكون برابط HTTPS صالح.');
  }
  return { ...project, lat, lng, images };
}

export function visibleProjects(projects, { finish = 'all', area = 'all', provider = 'all' } = {}) {
  return projects.filter(project => project.status === 'approved'
    && (finish === 'all' || project.finish === finish)
    && (area === 'all' || project.area === area)
    && (provider === 'all' || project.providerId === provider));
}

export function clusterProjects(projects, map, cellSize = 64) {
  const buckets = new Map();
  for (const project of projects) {
    const point = map.project([project.lat, project.lng], map.getZoom());
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(project);
  }
  return [...buckets.values()];
}

export const MAX_PROJECT_IMAGES = MAX_IMAGES;
export const EGYPT_MAP_BOUNDS = EGYPT_BOUNDS;
