import { ISO } from './math.js';

export const GROUND_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform float u_day, u_dusk, u_golden;
uniform vec3 u_seas;

uniform vec2 u_lanternPos;
uniform float u_lanternPower;
uniform float u_zoom;

void main(){
 vec4 base = texture2D(uSampler, vTextureCoord);
 vec3 col = base.rgb;
 vec3 nightCol = col * vec3(0.24, 0.35, 0.62);
 col = mix(nightCol, col * vec3(1.04, 1.03, 0.96), u_day);
 vec3 goldenCol = col * vec3(1.42, 0.95, 0.62);
 col = mix(col, goldenCol, u_golden * 0.85);
 col = mix(col, col * vec3(1.28, 0.82, 0.68), u_dusk * 0.45);
 col *= u_seas;

 // Real-time Cozy Shader Lantern Light (Natural Multiplicative Ground Illumination)
 if (u_lanternPower > 0.01) {
   vec2 fragScreen = vTextureCoord * inputSize.xy;
   vec2 delta = fragScreen - u_lanternPos;
   float isoDist = length(vec2(delta.x, delta.y * 1.9));

   // Natural physical light radius (~75 screen pixels, scales with camera zoom)
   float radius = 75.0 * max(0.5, u_zoom);

   if (isoDist < radius) {
     float normDist = isoDist / radius;
     // Smooth physical inverse-square quadratic falloff
     float atten = pow(1.0 - normDist, 2.2);

     // Detect water pixels in ground base texture
     float isWater = smoothstep(0.04, 0.20, base.b - max(base.r, base.g));

     // 1. Natural warm diffuse color enhancement (multiplies underlying terrain texture)
     vec3 warmTone = vec3(1.15, 0.90, 0.60);
     vec3 litCol = col * warmTone + col * vec3(0.48, 0.32, 0.14) * atten;

     // 2. Soft golden amber ambient center glow
     vec3 centerGlow = vec3(0.35, 0.22, 0.09) * atten * atten;

     // 3. Natural specular sheen on water surface
     float spec = pow(atten, 2.8) * isWater;
     vec3 specLight = vec3(0.80, 0.60, 0.35) * spec;

     vec3 finalLit = litCol + centerGlow + specLight;
     col = mix(col, finalLit, atten * u_lanternPower * 0.96);
   }
 }

 gl_FragColor = vec4(col, base.a);
}`;

export function createGroundFilter() {
  return new PIXI.Filter(null, GROUND_FRAG, {
    u_day: 1,
    u_dusk: 0,
    u_golden: 0,
    u_seas: [1, 1, 1],
    u_lanternPos: [0, 0],
    u_lanternPower: 0,
    u_zoom: 1
  });
}


