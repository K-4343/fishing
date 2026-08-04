// PNG 아이콘 생성기 v3 — 앱모양.png 참조 스타일
// 深네이비 배경 + 트라이벌 웨이브 링 + 기하학적 황금 물고기 + 낚시바늘
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// ── CRC32 + PNG 인코딩 ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type), d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(d.length, 0);
  c.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
  return Buffer.concat([l, t, d, c]);
}
function encodePNG(rgba, W, H) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    rgba.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 픽셀 그리기 ───────────────────────────────────────────────────────────
function blend(buf, W, H, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  if (a >= 255) { buf[i]=r; buf[i+1]=g; buf[i+2]=b; buf[i+3]=255; return; }
  if (a <= 0) return;
  const sa = a/255, da = buf[i+3]/255, oa = sa + da*(1-sa);
  if (oa > 0) {
    buf[i]   = Math.round((r*sa + buf[i]  *da*(1-sa))/oa);
    buf[i+1] = Math.round((g*sa + buf[i+1]*da*(1-sa))/oa);
    buf[i+2] = Math.round((b*sa + buf[i+2]*da*(1-sa))/oa);
    buf[i+3] = Math.min(255, Math.round(oa*255));
  }
}
function fillCirc(buf, W, H, cx, cy, radius, r, g, b, a) {
  const y0=Math.max(0,Math.floor(cy-radius-1)), y1=Math.min(H-1,Math.ceil(cy+radius+1));
  const r2=radius*radius;
  for (let y=y0; y<=y1; y++) {
    const dy=y-cy, dx2=r2-dy*dy;
    if (dx2<0) continue;
    const dx=Math.sqrt(dx2);
    for (let x=Math.max(0,Math.floor(cx-dx)); x<=Math.min(W-1,Math.ceil(cx+dx)); x++)
      blend(buf,W,H,x,y,r,g,b,a);
  }
}
function fillEll(buf, W, H, cx, cy, rx, ry, r, g, b, a) {
  const y0=Math.max(0,Math.floor(cy-ry-1)), y1=Math.min(H-1,Math.ceil(cy+ry+1));
  for (let y=y0; y<=y1; y++) {
    const dy=(y-cy)/ry;
    if (Math.abs(dy)>1) continue;
    const hw=Math.sqrt(1-dy*dy)*rx;
    for (let x=Math.max(0,Math.floor(cx-hw)); x<=Math.min(W-1,Math.ceil(cx+hw)); x++)
      blend(buf,W,H,x,y,r,g,b,a);
  }
}
function drawLine(buf, W, H, x1, y1, x2, y2, thick, r, g, b, a) {
  const dx=x2-x1, dy=y2-y1;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)*2));
  for (let i=0; i<=steps; i++) {
    const t=i/steps;
    fillCirc(buf,W,H,x1+dx*t,y1+dy*t,thick/2,r,g,b,a);
  }
}

// 다각형 스캔라인 채우기
function fillPolygon(buf, W, H, pts, r, g, b, a) {
  let minY=Infinity, maxY=-Infinity;
  for (const [,y] of pts) { minY=Math.min(minY,y); maxY=Math.max(maxY,y); }
  const n=pts.length;
  for (let y=Math.max(0,Math.floor(minY)); y<=Math.min(H-1,Math.ceil(maxY)); y++) {
    const xs=[];
    for (let i=0; i<n; i++) {
      const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%n];
      if ((y1<=y&&y2>y)||(y2<=y&&y1>y)) xs.push(x1+(y-y1)*(x2-x1)/(y2-y1));
    }
    xs.sort((a,b)=>a-b);
    for (let i=0; i<xs.length-1; i+=2) {
      for (let x=Math.max(0,Math.round(xs[i])); x<=Math.min(W-1,Math.round(xs[i+1])); x++)
        blend(buf,W,H,x,y,r,g,b,a);
    }
  }
}

// 환형(링) 채우기
function fillAnnulus(buf, W, H, cx, cy, rIn, rOut, r, g, b, a) {
  const r2in=rIn*rIn, r2out=rOut*rOut;
  const y0=Math.max(0,Math.floor(cy-rOut)), y1=Math.min(H-1,Math.ceil(cy+rOut));
  for (let y=y0; y<=y1; y++) for (let x=Math.max(0,Math.floor(cx-rOut)); x<=Math.min(W-1,Math.ceil(cx+rOut)); x++) {
    const d2=(x-cx)*(x-cx)+(y-cy)*(y-cy);
    if (d2>=r2in&&d2<=r2out) blend(buf,W,H,x,y,r,g,b,a);
  }
}

// ── 트라이벌 웨이브 링 ────────────────────────────────────────────────────
// 접근: 환형 베이스 + 8개 웨이브 스크롤(두꺼운 곡선) + 흰색 하이라이트
function drawWaveScroll(buf, S, cx, cy, centerAngle, rIn, rOut, r, g, b, a) {
  const arcSpan = (Math.PI*2/8) * 0.96;  // 96% - 스크롤 간 약간의 간격
  const steps = 180;
  const rMid  = (rIn+rOut)/2;
  const band  = (rOut-rIn)/2;

  for (let i=0; i<=steps; i++) {
    const t   = i/steps;
    const ang = centerAngle - arcSpan/2 + arcSpan*t;
    // 중앙에서 내부로 파고드는 파형
    const wave    = Math.sin(t*Math.PI);
    const scrollR = rOut - band*1.65*wave;
    // 스트로크 두께: 끝은 가늘고 중앙은 두껍게
    const thick   = band*(0.25 + 0.75*wave);
    fillCirc(buf,S,S, cx+Math.cos(ang)*scrollR, cy+Math.sin(ang)*scrollR,
             Math.max(2,thick), r,g,b,a);
  }
}

// 스크롤 끝의 나선형 컬
function drawScrollCurl(buf, S, cx, cy, centerAngle, rOut, curlSide, r, g, b, a) {
  const arcSpan = Math.PI*2/8;
  const startAng = centerAngle + (curlSide>0 ? arcSpan/2 : -arcSpan/2);
  const curlR = (rOut-((rOut-(rOut-rOut*0.22))/2))*0.25;
  const curlCx = cx + Math.cos(startAng)*(rOut-curlR*1.8);
  const curlCy = cy + Math.sin(startAng)*(rOut-curlR*1.8);

  for (let a=0; a<=Math.PI*1.5; a+=0.07) {
    const rr = curlR*(1 - a/(Math.PI*1.5)*0.6);
    fillCirc(buf,S,S,
      curlCx+Math.cos(startAng+curlSide*(a+Math.PI))*rr,
      curlCy+Math.sin(startAng+curlSide*(a+Math.PI))*rr,
      Math.max(1, curlR*0.35*(1-a/(Math.PI*1.5)*0.5)), r,g,b,a);
  }
}

// 트라이벌 삼각형 액센트 (링 경계부 화살표)
function drawTriAccent(buf, S, cx, cy, angle, rOut, r, g, b, a) {
  const tipX  = cx+Math.cos(angle)*(rOut+2);
  const tipY  = cy+Math.sin(angle)*(rOut+2);
  const base1X= cx+Math.cos(angle+0.22)*(rOut-12);
  const base1Y= cy+Math.sin(angle+0.22)*(rOut-12);
  const base2X= cx+Math.cos(angle-0.22)*(rOut-12);
  const base2Y= cy+Math.sin(angle-0.22)*(rOut-12);
  fillPolygon(buf,S,S, [[tipX,tipY],[base1X,base1Y],[base2X,base2Y]], r,g,b,a);
}

// ── 기하학적 물고기 (참조 이미지 스타일) ────────────────────────────────
function drawFish(buf, S, cx, cy, scale, BG) {
  const G  = [245, 177, 28];   // 황금 앰버 #F5B11C
  const s  = scale;

  // 몸통: 넓은 다이아몬드형 다각형 (참조 이미지처럼 기하학적)
  const body = [
    [cx - s*0.88, cy + 0],           // 꼬리 연결점 (좌)
    [cx - s*0.55, cy + s*0.50],       // 하체 좌측
    [cx + s*0.40, cy + s*0.28],       // 하악
    [cx + s*0.94, cy + 0],            // 입 끝 (우)
    [cx + s*0.40, cy - s*0.28],       // 상악
    [cx - s*0.55, cy - s*0.50],       // 상체 좌측
  ];
  fillPolygon(buf,S,S, body, ...G, 255);

  // 꼬리 위 삼각형 로브
  const tailUp = [
    [cx - s*0.88, cy - s*0.04],
    [cx - s*0.78, cy - s*0.46],
    [cx - s*1.38, cy - s*0.74],
    [cx - s*1.12, cy - s*0.16],
  ];
  fillPolygon(buf,S,S, tailUp, ...G, 255);

  // 꼬리 아래 삼각형 로브
  const tailDn = [
    [cx - s*0.88, cy + s*0.04],
    [cx - s*0.78, cy + s*0.46],
    [cx - s*1.38, cy + s*0.74],
    [cx - s*1.12, cy + s*0.16],
  ];
  fillPolygon(buf,S,S, tailDn, ...G, 255);

  // 등지느러미 (삼각형)
  const dors = [
    [cx - s*0.52, cy - s*0.50],
    [cx - s*0.02, cy - s*0.50],
    [cx - s*0.27, cy - s*0.94],
  ];
  fillPolygon(buf,S,S, dors, ...G, 255);

  // 가슴지느러미 (소형 삼각형)
  const pect = [
    [cx + s*0.12, cy + s*0.28],
    [cx + s*0.42, cy + s*0.42],
    [cx + s*0.22, cy + s*0.60],
    [cx + s*0.00, cy + s*0.48],
  ];
  fillPolygon(buf,S,S, pect, ...G, 200);

  // 눈 (深네이비 원)
  const eR = Math.max(2, s*0.080);
  fillCirc(buf,S,S, cx+s*0.60, cy-s*0.04, eR, BG[0],BG[1],BG[2], 255);
  // 눈 하이라이트
  fillCirc(buf,S,S, cx+s*0.60+eR*0.25, cy-s*0.04-eR*0.25, eR*0.35, 255,255,255,200);

  // ── 낚시바늘 (참조: 몸통을 가로지르는 J자 형태, 배경색으로) ──────────
  const hkR  = s*0.350;
  const hkCx = cx + s*0.08;
  const hkCy = cy - s*0.12;
  const hkT  = Math.max(2, s*0.062);
  // J-호 (몸통 관통)
  for (let a=-Math.PI*0.85; a<=Math.PI*0.50; a+=0.04)
    fillCirc(buf,S,S, hkCx+Math.cos(a)*hkR, hkCy+Math.sin(a)*hkR, hkT, BG[0],BG[1],BG[2],255);
  // 샤프트 (세로)
  drawLine(buf,S,S, hkCx, hkCy-hkR, hkCx, hkCy-hkR*0.45, hkT*2, BG[0],BG[1],BG[2],255);
  // 미늘 (barb)
  drawLine(buf,S,S, hkCx+hkR, hkCy+hkR*0.1, hkCx+hkR*0.60, hkCy-hkR*0.30, hkT, BG[0],BG[1],BG[2],255);
}

// ── 메인 아이콘 드로잉 ─────────────────────────────────────────────────────
function drawIcon(S, maskable) {
  const buf = Buffer.alloc(S*S*4);
  const cx=S/2, cy=S/2;

  // 색상
  const BG   = [8, 16, 42];           // 深네이비 배경 #08102a
  const RING1 = [142, 198, 225];       // 밝은 스틸블루 #8ec6e1
  const RING2 = [185, 225, 245];       // 연한 하늘색 #b9e1f5
  const WHITE = [255, 255, 255];

  // ── 배경 ──
  const cr = maskable ? 0 : Math.round(S*0.185);
  for (let y=0; y<S; y++) for (let x=0; x<S; x++) {
    const cdx = cr>0 ? Math.max(0, cr-x-0.5, x-(S-cr)+0.5) : 0;
    const cdy = cr>0 ? Math.max(0, cr-y-0.5, y-(S-cr)+0.5) : 0;
    if (cdx*cdx+cdy*cdy>cr*cr) continue;
    const dist = Math.hypot(x-cx, y-cy)/(S*0.5);
    const lum  = Math.max(0,(1-dist)*0.28);
    const i=(y*S+x)*4;
    buf[i]  =Math.min(255,Math.round(BG[0]*(1+lum*1.2)));
    buf[i+1]=Math.min(255,Math.round(BG[1]*(1+lum*1.5)));
    buf[i+2]=Math.min(255,Math.round(BG[2]*(1+lum*0.8)));
    buf[i+3]=255;
  }

  // ── 트라이벌 웨이브 링 ──
  const sc   = maskable ? 0.66 : 1.0;
  const rIn  = S*0.283*sc;
  const rOut = S*0.428*sc;
  const rMid = (rIn+rOut)/2;
  const N    = 8;

  // 베이스 링 (스틸블루)
  fillAnnulus(buf,S,S,cx,cy, rIn-4, rOut+4, ...RING1, 240);

  // 8개 웨이브 스크롤 레이어 1 (기본 색)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.PI/N*0.5;
    drawWaveScroll(buf,S,cx,cy,ang, rIn,rOut, ...RING2, 215);
  }
  // 8개 웨이브 스크롤 레이어 2 (위상 반전 — 앞뒤 엇갈림 효과)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2;
    drawWaveScroll(buf,S,cx,cy,ang, rIn+4,rOut-4, ...RING1, 180);
  }
  // 흰색 하이라이트 스크롤 (더 안쪽, 반투명)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.PI/N*0.5;
    drawWaveScroll(buf,S,cx,cy,ang, rIn+6,rOut-6, ...WHITE, 90);
  }

  // 나선형 컬 (각 스크롤 끝 장식)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.PI/N*0.5;
    drawScrollCurl(buf,S,cx,cy,ang,rOut,-1,...RING2,200);
    drawScrollCurl(buf,S,cx,cy,ang,rOut, 1,...RING2,200);
  }

  // 삼각형 액센트 (링 외곽 경계)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2;
    drawTriAccent(buf,S,cx,cy,ang,rOut+6,...RING2,220);
  }
  // 안쪽 삼각형 액센트 (반대 방향)
  for (let i=0; i<N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.PI/N;
    drawTriAccent(buf,S,cx,cy,ang,rIn-6,...RING1,180);
  }

  // 링 내부/외부 경계선 (얇은 흰 선)
  for (let a=0; a<Math.PI*2; a+=0.01) {
    blend(buf,S,S, Math.round(cx+Math.cos(a)*rOut), Math.round(cy+Math.sin(a)*rOut), 255,255,255,90);
    blend(buf,S,S, Math.round(cx+Math.cos(a)*(rOut+3)), Math.round(cy+Math.sin(a)*(rOut+3)), 255,255,255,50);
    blend(buf,S,S, Math.round(cx+Math.cos(a)*rIn), Math.round(cy+Math.sin(a)*rIn), 255,255,255,70);
  }

  // ── 중앙 기하학적 황금 물고기 ──
  const fishScale = S*0.168*sc;
  drawFish(buf,S,cx,cy,fishScale,BG);

  return buf;
}

// ── 파일 생성 ──────────────────────────────────────────────────────────────
const iconDir = path.join(__dirname,'icons');
if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir,{recursive:true});

for (const [size,name,maskable] of [
  [192,'icon-192.png',false],
  [512,'icon-512.png',false],
  [512,'icon-maskable.png',true],
]) {
  const buf=drawIcon(size,maskable);
  const png=encodePNG(buf,size,size);
  fs.writeFileSync(path.join(iconDir,name),png);
  console.log(`✓ ${name}  (${size}×${size}, ${(png.length/1024).toFixed(1)} KB)`);
}
console.log('완료 →',iconDir);
