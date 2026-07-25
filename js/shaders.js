import { ISO } from './math.js';

export const GROUND_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float u_day, u_dusk, u_golden;
uniform vec3 u_seas;

void main(){
 vec4 base = texture2D(uSampler, vTextureCoord);
 vec3 col = base.rgb;
 vec3 nightCol = col * vec3(0.24, 0.35, 0.62);
 col = mix(nightCol, col * vec3(1.04, 1.03, 0.96), u_day);
 vec3 goldenCol = col * vec3(1.42, 0.95, 0.62);
 col = mix(col, goldenCol, u_golden * 0.85);
 col = mix(col, col * vec3(1.28, 0.82, 0.68), u_dusk * 0.45);
 col *= u_seas;
 gl_FragColor = vec4(col, base.a);
}`;

export function createGroundFilter() {
  return new PIXI.Filter(null, GROUND_FRAG, {
    u_day: 1,
    u_dusk: 0,
    u_golden: 0,
    u_seas: [1, 1, 1]
  });
}

