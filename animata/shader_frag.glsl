#version 330

out vec4 FragColor;

uniform vec3  iResolution;   // (width, height, 1.0)
uniform float iTime;         // driven by the Python script to guarantee 4s loop

// Your new controls:
uniform ivec4 uHueI;         // four ints in [0..6]
uniform float uRotSpeed;     // 2.0, 3.0, or 4.0  (used as divisor in iTime/uRotSpeed)
uniform float uScale;        // replaces ".08"  (0.08 .. 0.18 step 0.01)
uniform float uDotDiv;       // replaces ".7"   (0.5 .. 0.9 step 0.1)

#define PI 3.14159265358979323846

void mainImage(out vec4 O, vec2 I)
{
    float d = 0.0;
    float s = 0.0;
    vec3  p;
    vec3  r = iResolution;

    // rotation matrix from your original:
    // mat2 R = mat2(cos(iTime/2. + vec4(0,33,11,0)));
    // generalized to use uRotSpeed instead of literal "2"
    vec4  ph = vec4(0.0, 33.0, 11.0, 0.0);
    vec4  c  = cos(iTime / uRotSpeed + ph);
    mat2  R  = mat2(c.x, c.y, c.z, c.w);

    // map 0..6 to 7 evenly spaced hue phase steps around [0..2π)
    vec4 hue = (2.0*PI/7.0) * vec4(uHueI);

    O = vec4(0.0);
    for (int k = 0; k < 100; ++k) {
        float i = float(k) + 1.0;

        p = vec3(((I + I - r.xy) / r.y) * d * R, d - 8.0);
        p.xz *= R;

        s  = 0.012 + uScale *
             abs( max( sin(dot(p.yzx, p) / uDotDiv), length(p) - 4.0 ) - i / 100.0 );

        d += s;

        O += max( 1.3 * sin(hue + i * 0.3) / s,
                  -length(p * p) );
    }

    O = tanh(O * O / 800000.0);
}

void main() {
    vec4 col;
    mainImage(col, gl_FragCoord.xy);
    FragColor = vec4(clamp(col.rgb, 0.0, 1.0), 1.0);
}
