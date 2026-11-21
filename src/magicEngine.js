
import { recognizeGesture } from './gestureEngine.js';

function getPoint(landmarks, index, width, height) {
  return {
    x: landmarks[index].x * width,
    y: landmarks[index].y * height
  };
}

// Glowing magical circle
function drawMagicCircle(ctx, x, y, radius, rotation, time) {

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.shadowColor = '#ff9900';
  ctx.shadowBlur = 25;
  ctx.strokeStyle = '#ffb52e';
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.5;

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;

    ctx.beginPath();
    ctx.moveTo(
      Math.cos(angle) * radius * 0.78,
      Math.sin(angle) * radius * 0.78
    );
    ctx.lineTo(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.68, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// OPEN PALM - ENERGY SHIELD
function drawShield(ctx, hand, width, height, time) {

  const wrist = getPoint(hand, 0, width, height);
  const index = getPoint(hand, 5, width, height);
  const pinky = getPoint(hand, 17, width, height);

  const centerX = (index.x + pinky.x) / 2;
  const centerY = (index.y + pinky.y) / 2;

  const radius = Math.max(
    75,
    Math.hypot(index.x - pinky.x, index.y - pinky.y) * 1.25
  );

  const rotation = time * 0.0005;

  ctx.save();

  // Outer magical aura
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 5,
    centerX, centerY, radius * 1.3
  );

  gradient.addColorStop(0, 'rgba(255,170,30,0.04)');
  gradient.addColorStop(0.7, 'rgba(255,140,0,0.14)');
  gradient.addColorStop(1, 'rgba(255,140,0,0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.3, 0, Math.PI * 2);
  ctx.fill();

  // Rotating outer circle
  drawMagicCircle(ctx, centerX, centerY, radius, rotation, time);

  // Inner shield
  ctx.translate(centerX, centerY);

  ctx.shadowColor = '#ff9d16';
  ctx.shadowBlur = 30;

  ctx.strokeStyle = '#ffd16b';
  ctx.lineWidth = 3;

  ctx.beginPath();

  ctx.moveTo(0, -radius * 0.9);
  ctx.lineTo(radius * 0.72, -radius * 0.5);
  ctx.lineTo(radius * 0.62, radius * 0.45);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius * 0.62, radius * 0.45);
  ctx.lineTo(-radius * 0.72, -radius * 0.5);
  ctx.closePath();

  ctx.stroke();

  ctx.fillStyle = 'rgba(255,170,30,0.09)';
  ctx.fill();

  // Animated inner rings
  ctx.rotate(-rotation * 2);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.48, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Connection from shield to hand
  ctx.save();
  ctx.strokeStyle = 'rgba(255,190,70,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();
  ctx.restore();
}

// PINCH - ENERGY ORB
function drawOrb(ctx, hand, width, height, time) {

  const thumb = getPoint(hand, 4, width, height);
  const index = getPoint(hand, 8, width, height);

  const x = (thumb.x + index.x) / 2;
  const y = (thumb.y + index.y) / 2;

  const pulse = 18 + Math.sin(time * 0.008) * 5;

  ctx.save();

  const glow = ctx.createRadialGradient(
    x, y, 2, x, y, pulse * 2.5
  );

  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.2, '#fff1a6');
  glow.addColorStop(0.5, '#ff9d18');
  glow.addColorStop(1, 'rgba(255,120,0,0)');

  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, pulse * 2.5, 0, Math.PI * 2);
  ctx.fill();

  drawMagicCircle(ctx, x, y, pulse * 2, time * 0.001, time);

  ctx.restore();
}

// FIST - ENERGY CHARGE
function drawCharge(ctx, hand, width, height, time) {

  const center = getPoint(hand, 9, width, height);

  const radius = 55 + Math.sin(time * 0.01) * 8;

  ctx.save();

  ctx.shadowColor = '#ff7600';
  ctx.shadowBlur = 35;

  ctx.strokeStyle = '#ffb52e';
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  drawMagicCircle(
    ctx,
    center.x,
    center.y,
    radius * 1.4,
    -time * 0.001,
    time
  );

  ctx.restore();
}

// TWO FINGERS - MAGIC BEAM
function drawBeam(ctx, hand, width, height, time) {

  const index = getPoint(hand, 8, width, height);
  const middle = getPoint(hand, 12, width, height);

  const x = (index.x + middle.x) / 2;
  const y = (index.y + middle.y) / 2;

  const endX = x;
  const endY = y - 300;

  ctx.save();

  const gradient = ctx.createLinearGradient(x, y, endX, endY);

  gradient.addColorStop(0, '#fff2ae');
  gradient.addColorStop(0.3, '#ffae24');
  gradient.addColorStop(1, 'rgba(255,130,0,0)');

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 10;
  ctx.shadowColor = '#ff9c00';
  ctx.shadowBlur = 30;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  ctx.restore();
}

// MAIN MAGIC ENGINE
export function drawMagicEffect(ctx, hands, width, height, time) {

  for (const hand of hands) {

    const gesture = recognizeGesture(hand);

    switch (gesture) {

      case 'OPEN_PALM':
        drawShield(ctx, hand, width, height, time);
        break;

      case 'PINCH':
        drawOrb(ctx, hand, width, height, time);
        break;

      case 'FIST':
        drawCharge(ctx, hand, width, height, time);
        break;

      case 'TWO_FINGERS':
        drawBeam(ctx, hand, width, height, time);
        break;
    }
  }
}
