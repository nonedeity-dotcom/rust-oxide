// Детализация поверхностей поверх обычных Lambert-материалов: земля, деревья, камни.
// Одна общая процедурная текстура (texdata.js) даёт зерно, трещины и «рельеф» (bump) без файлов с картинками.
import * as THREE from 'three';
import { makeDetailData, DETAIL_SIZE } from './texdata.js';

const tex = new THREE.DataTexture(makeDetailData(), DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.generateMipmaps = true;
tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4; tex.needsUpdate = true;

// xuAmt — сила детализации (качество), xuBump — рельеф (0 — выключен на «Низкой»)
export const DETAIL = { xuDetail: { value: tex }, xuAmt: { value: 1 }, xuBump: { value: 1 } };

const FRAG_COMMON = `
uniform sampler2D xuDetail; uniform float xuAmt; uniform float xuBump;
// рельеф по производным (как bumpMap, но без UV): h — «высота» из текстуры, k — сила
vec3 xuBumpN(vec3 N, vec3 vp, float h, float k) {
  vec3 sx = dFdx(vp), sy = dFdy(vp);
  vec3 R1 = cross(sy, N), R2 = cross(N, sx);
  float det = dot(sx, R1) * (gl_FrontFacing ? 1.0 : -1.0);
  if (abs(det) < 1e-12) return N;
  vec3 g = sign(det) * (dFdx(h) * R1 + dFdy(h) * R2);
  return normalize(abs(det) * N - g * k);
}`;

// вставляет код после нужной строки шейдера
const after = (src, line, add) => src.replace(line, line + '\n' + add);

function patch(mat, key, { vCommon, vBegin, fCommon, fColor, fNormal }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, DETAIL);
    let v = after(sh.vertexShader, '#include <common>', vCommon);
    v = after(v, '#include <begin_vertex>', vBegin);
    v = after(v, '#include <project_vertex>', 'xvV = mvPosition.xyz; xvD = length(mvPosition.xyz);');
    sh.vertexShader = v;
    let f = after(sh.fragmentShader, '#include <common>', FRAG_COMMON + fCommon);
    f = after(f, '#include <color_fragment>', fColor);
    f = after(f, '#include <normal_fragment_maps>', fNormal);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------- земля: у меша должен быть атрибут aW (вес биома: лес, пустыня/пляж, снег) ----------
export const patchGround = (mat) => patch(mat, 'xust-ground', {
  vCommon: 'attribute vec3 aW; varying vec3 xvW; varying vec2 xvP; varying vec3 xvV; varying float xvD;',
  vBegin: 'xvW = aW; xvP = position.xz;',
  fCommon: 'varying vec3 xvW; varying vec2 xvP; varying vec3 xvV; varying float xvD;',
  fColor: `
    float xFn = 1.0 - smoothstep(25.0, 75.0, xvD);
    float xFf = 1.0 - smoothstep(110.0, 240.0, xvD);
    vec3 xDn = texture2D(xuDetail, xvP * 0.42).rgb;
    vec3 xDm = texture2D(xuDetail, xvP * 1.9 + vec2(0.5, 0.2)).rgb;
    vec3 xDf = texture2D(xuDetail, xvP * 0.063 + vec2(0.37, 0.11)).rgb;
    float xK = xvW.x * 0.5 + xvW.y * 0.34 + xvW.z * 0.14;
    float xMul = 1.0 + ((xDm.r - 0.5) * 0.5 + (xDn.r - 0.5) * 0.8) * xK * xFn * xuAmt + (xDf.b - 0.5) * 0.5 * (xvW.x * 0.9 + xvW.y * 0.5 + xvW.z * 0.25) * xFf;
    xMul += sin((xvP.x * 0.9 + xvP.y * 0.55) * 5.0 + xDf.b * 9.0) * 0.045 * xvW.y * xFn * xuAmt;
    xMul *= 1.0 - (1.0 - xDn.g) * (xvW.y * 0.2 + xvW.x * 0.08) * xFn * xuAmt;
    diffuseColor.rgb *= xMul;
    diffuseColor.rgb += xvW.z * smoothstep(0.94, 1.0, xDm.g) * 0.12 * xFn * xuAmt;`,
  fNormal: `
    float xH = xDn.r * 0.65 + xDm.r * 0.35;
    normal = xuBumpN(normal, xvV, xH, 0.14 * xuBump * xFn * (xvW.x + xvW.y * 0.8 + xvW.z * 0.4));`,
});

// ---------- деревья: у геометрии есть атрибут aBark (1 — ствол, 0 — крона) ----------
export const patchTrees = (mat) => patch(mat, 'xust-trees', {
  vCommon: 'attribute float aBark; varying float xvB; varying vec3 xvO; varying vec3 xvV; varying float xvD;',
  vBegin: 'xvB = aBark; xvO = position;',
  fCommon: 'varying float xvB; varying vec3 xvO; varying vec3 xvV; varying float xvD;',
  fColor: `
    float xFd = 1.0 - smoothstep(35.0, 110.0, xvD);
    vec2 xBu = vec2((xvO.x + xvO.z) * 1.5, xvO.y * 0.22);
    vec3 xBk = texture2D(xuDetail, xBu).rgb;
    vec3 xBk2 = texture2D(xuDetail, xBu * vec2(3.1, 1.3) + 0.3).rgb;
    vec2 xLu = vec2(xvO.x * 0.7 + xvO.y * 0.5, xvO.z * 0.7 + xvO.y * 0.4);
    vec3 xLf = texture2D(xuDetail, xLu).rgb;
    vec3 xLf2 = texture2D(xuDetail, xLu * 3.3 + 0.5).rgb;
    float xBarkM = 1.0 + (xBk.r - 0.5) * 0.9 + (xBk2.r - 0.5) * 0.6;
    float xLeafM = 1.0 + (xLf.g - 0.5) * 0.7 + (xLf2.r - 0.5) * 0.5;
    float xM = 1.0 + (mix(xLeafM, xBarkM, xvB) - 1.0) * xuAmt;
    float xAo = mix(0.78, 1.08, smoothstep(0.2, 4.5, xvO.y));
    diffuseColor.rgb *= mix(1.0, xM * xAo, xFd);`,
  fNormal: `
    float xH = mix(xLf.g * 0.6 + xLf2.r * 0.4, xBk.r * 0.7 + xBk2.r * 0.3, xvB);
    normal = xuBumpN(normal, xvV, xH, mix(0.12, 0.35, xvB) * xuBump * xFd);`,
});

// ---------- камни и руда: трипланарная текстура в координатах модели + мох на серых верхних гранях ----------
export const patchRocks = (mat) => patch(mat, 'xust-rocks', {
  vCommon: 'varying vec3 xvO; varying vec3 xvN; varying vec3 xvV; varying float xvD;',
  vBegin: 'xvO = position; xvN = normal;',
  fCommon: 'varying vec3 xvO; varying vec3 xvN; varying vec3 xvV; varying float xvD;',
  fColor: `
    float xFd = 1.0 - smoothstep(30.0, 90.0, xvD);
    vec3 xBw = pow(abs(normalize(xvN)), vec3(4.0)); xBw /= (xBw.x + xBw.y + xBw.z);
    vec3 xP = xvO * 0.8;
    vec3 xA = texture2D(xuDetail, xP.yz).rgb * xBw.x + texture2D(xuDetail, xP.xz + 0.31).rgb * xBw.y + texture2D(xuDetail, xP.xy + 0.67).rgb * xBw.z;
    vec3 xQ = xvO * 3.4;
    float xF = texture2D(xuDetail, xQ.yz).r * xBw.x + texture2D(xuDetail, xQ.xz + 0.13).r * xBw.y + texture2D(xuDetail, xQ.xy + 0.47).r * xBw.z;
    float xMul = (1.0 + (xA.r - 0.5) * 0.9 + (xF - 0.5) * 0.7) * mix(0.6, 1.0, smoothstep(0.0, 0.45, xA.g));
    xMul = 1.0 + (xMul - 1.0) * xuAmt * xFd;
    float xGrey = 1.0 - clamp((max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) * 5.0, 0.0, 1.0);
    float xMoss = smoothstep(0.55, 0.92, normalize(xvN).y) * smoothstep(0.35, 0.7, xA.b) * xGrey;
    diffuseColor.rgb *= xMul;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.34, 0.12) * (0.8 + xA.r * 0.5), xMoss * 0.55 * xuAmt);`,
  fNormal: `
    float xH = xA.r * 0.7 + xF * 0.3;
    normal = xuBumpN(normal, xvV, xH, 0.28 * xuBump * xFd);`,
});
