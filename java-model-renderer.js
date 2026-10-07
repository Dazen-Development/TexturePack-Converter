function deg(value) {
  return Number(value || 0) * Math.PI / 180;
}

function rotatePoint(point, axis, angle, origin = [8, 8, 8]) {
  if (!angle) return [...point];

  let [x, y, z] = point;
  const [ox, oy, oz] = origin;
  x -= ox;
  y -= oy;
  z -= oz;

  const c = Math.cos(angle);
  const s = Math.sin(angle);

  if (axis === 'x') {
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  } else if (axis === 'y') {
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx;
    z = nz;
  } else if (axis === 'z') {
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }

  return [x + ox, y + oy, z + oz];
}

function applyElementRotation(point, rotation) {
  if (!rotation || !rotation.axis || !Number(rotation.angle)) {
    return [...point];
  }

  return rotatePoint(
    point,
    String(rotation.axis).toLowerCase(),
    deg(rotation.angle),
    Array.isArray(rotation.origin) ? rotation.origin : [8, 8, 8]
  );
}

function applyGuiTransform(point, display = {}) {
  let p = [
    point[0] - 8,
    point[1] - 8,
    point[2] - 8,
  ];

  const rotation = Array.isArray(display.rotation)
    ? display.rotation
    : [30, 225, 0];

  // Minecraft item display rotations are Euler rotations. This order gives a
  // stable GUI-like orthographic result for Blockbench item exports.
  p = rotatePoint(p, 'x', deg(rotation[0]), [0, 0, 0]);
  p = rotatePoint(p, 'y', deg(rotation[1]), [0, 0, 0]);
  p = rotatePoint(p, 'z', deg(rotation[2]), [0, 0, 0]);

  const translation = Array.isArray(display.translation)
    ? display.translation
    : [0, 0, 0];

  return [
    p[0] + Number(translation[0] || 0),
    p[1] + Number(translation[1] || 0),
    p[2] + Number(translation[2] || 0),
  ];
}

function boxVertices(from, to) {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;

  return {
    nwl: [x1, y2, z1],
    nwr: [x2, y2, z1],
    nel: [x1, y1, z1],
    ner: [x2, y1, z1],
    swl: [x1, y2, z2],
    swr: [x2, y2, z2],
    sel: [x1, y1, z2],
    ser: [x2, y1, z2],
  };
}

const FACE_VERTICES = {
  north: ['nwl', 'nwr', 'ner', 'nel'],
  south: ['swr', 'swl', 'sel', 'ser'],
  west: ['swl', 'nwl', 'nel', 'sel'],
  east: ['nwr', 'swr', 'ser', 'ner'],
  up: ['swl', 'swr', 'nwr', 'nwl'],
  down: ['nel', 'ner', 'ser', 'sel'],
};

function uvCorners(face, image) {
  const uv = Array.isArray(face?.uv) && face.uv.length === 4
    ? face.uv.map(Number)
    : [0, 0, 16, 16];

  const framePixels = Math.min(image.width, image.height);
  const uScale = image.width / 16;
  const vScale = framePixels / 16;

  let corners = [
    [uv[0] * uScale, uv[1] * vScale],
    [uv[2] * uScale, uv[1] * vScale],
    [uv[2] * uScale, uv[3] * vScale],
    [uv[0] * uScale, uv[3] * vScale],
  ];

  const turns = (((Number(face?.rotation || 0) / 90) % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) {
    corners = [corners[3], corners[0], corners[1], corners[2]];
  }

  return corners;
}

function resolveTextureRef(raw, textures) {
  let value = raw;
  const seen = new Set();

  while (typeof value === 'string' && value.startsWith('#')) {
    const key = value.slice(1);
    if (seen.has(key)) return null;
    seen.add(key);
    value = textures?.[key];
  }

  return typeof value === 'string' ? value : null;
}

async function decodeImage(blob) {
  if (!blob) return null;

  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {}
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = error => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}

function triangleTransform(source, target) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = target;

  const det =
    s0[0] * (s1[1] - s2[1]) +
    s1[0] * (s2[1] - s0[1]) +
    s2[0] * (s0[1] - s1[1]);

  if (Math.abs(det) < 1e-8) return null;

  const a =
    (d0[0] * (s1[1] - s2[1]) +
      d1[0] * (s2[1] - s0[1]) +
      d2[0] * (s0[1] - s1[1])) / det;
  const c =
    (d0[0] * (s2[0] - s1[0]) +
      d1[0] * (s0[0] - s2[0]) +
      d2[0] * (s1[0] - s0[0])) / det;
  const e =
    (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / det;

  const b =
    (d0[1] * (s1[1] - s2[1]) +
      d1[1] * (s2[1] - s0[1]) +
      d2[1] * (s0[1] - s1[1])) / det;
  const d =
    (d0[1] * (s2[0] - s1[0]) +
      d1[1] * (s0[0] - s2[0]) +
      d2[1] * (s1[0] - s0[0])) / det;
  const f =
    (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) +
      d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) +
      d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / det;

  return [a, b, c, d, e, f];
}

function drawTexturedTriangle(ctx, image, source, target) {
  const matrix = triangleTransform(source, target);
  if (!matrix) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(target[0][0], target[0][1]);
  ctx.lineTo(target[1][0], target[1][1]);
  ctx.lineTo(target[2][0], target[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(...matrix);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function canvasToBlob(canvas) {
  return new Promise(resolve => {
    canvas.toBlob(resolve, 'image/png');
  });
}

/**
 * Render a Java Blockbench-style item model to a distinct inventory icon.
 *
 * This is intentionally an inventory-icon renderer, not a Java->Bedrock
 * geometry converter. It uses the model's cuboids, element rotations, UVs and
 * GUI display rotation so packs that share one texture atlas still produce a
 * unique 2D icon per item.
 */
export async function renderJavaItemModel({
  model,
  loadTexture,
  size = 256,
}) {
  if (!model || !Array.isArray(model.elements) || !model.elements.length) {
    return null;
  }

  const textures = model.textures && typeof model.textures === 'object'
    ? model.textures
    : {};
  const textureCache = new Map();

  const getTexture = async raw => {
    const ref = resolveTextureRef(raw, textures);
    if (!ref) return null;
    if (textureCache.has(ref)) return textureCache.get(ref);

    try {
      const blob = await loadTexture(ref);
      const image = blob ? await decodeImage(blob) : null;
      textureCache.set(ref, image);
      return image;
    } catch {
      textureCache.set(ref, null);
      return null;
    }
  };

  const display =
    model.display?.gui ||
    model.display?.fixed ||
    {};

  const faces = [];
  const allPoints = [];

  for (const element of model.elements) {
    if (!Array.isArray(element?.from) || !Array.isArray(element?.to)) continue;
    const vertices = boxVertices(element.from.map(Number), element.to.map(Number));

    for (const [faceName, face] of Object.entries(element.faces || {})) {
      const vertexNames = FACE_VERTICES[faceName];
      if (!vertexNames || !face?.texture) continue;

      const image = await getTexture(face.texture);
      if (!image) continue;

      const transformed = vertexNames.map(name => {
        let point = applyElementRotation(vertices[name], element.rotation);
        point = applyGuiTransform(point, display);
        return point;
      });

      transformed.forEach(point => allPoints.push(point));

      faces.push({
        image,
        uv: uvCorners(face, image),
        points: transformed,
        depth:
          transformed.reduce((sum, point) => sum + point[2], 0) /
          transformed.length,
      });
    }
  }

  if (!faces.length || !allPoints.length) {
    for (const image of textureCache.values()) image?.close?.();
    return null;
  }

  const minX = Math.min(...allPoints.map(point => point[0]));
  const maxX = Math.max(...allPoints.map(point => point[0]));
  const minY = Math.min(...allPoints.map(point => point[1]));
  const maxY = Math.max(...allPoints.map(point => point[1]));

  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const padding = size * 0.075;
  const scale = Math.min(
    (size - padding * 2) / width,
    (size - padding * 2) / height
  );

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const project = point => [
    size / 2 + (point[0] - centerX) * scale,
    size / 2 - (point[1] - centerY) * scale,
  ];

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', {
    alpha: true,
    willReadFrequently: false,
  });
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  faces.sort((a, b) => a.depth - b.depth);

  for (const face of faces) {
    const target = face.points.map(project);

    drawTexturedTriangle(
      ctx,
      face.image,
      [face.uv[0], face.uv[1], face.uv[2]],
      [target[0], target[1], target[2]]
    );
    drawTexturedTriangle(
      ctx,
      face.image,
      [face.uv[0], face.uv[2], face.uv[3]],
      [target[0], target[2], target[3]]
    );
  }

  const blob = await canvasToBlob(canvas);

  for (const image of textureCache.values()) {
    image?.close?.();
  }

  return blob;
}
