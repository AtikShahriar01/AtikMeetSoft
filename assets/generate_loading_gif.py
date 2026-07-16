import os
import math
import random
from PIL import Image, ImageDraw, ImageFont

def create_loader_gif():
    # Dimensions (Super-sampled at 3x resolution for ultra-sharp rendering)
    width, height = 400, 300
    scale = 3
    sw, sh = width * scale, height * scale
    
    # Load and prepare icon
    icon_path = os.path.join("assets", "icon.png")
    icon = None
    if os.path.exists(icon_path):
        icon_orig = Image.open(icon_path).convert("RGBA")
        # Resize to 80x80 at normal scale (240x240 at super-scale)
        icon = icon_orig.resize((80 * scale, 80 * scale), Image.Resampling.LANCZOS)
        
    frames = []
    num_frames = 60 # 60 frames for ultra-smooth 2-second loop at 30 FPS
    
    # Generate stationary random particles
    random.seed(42) # Seed for deterministic floating particles
    particles = []
    for _ in range(25):
        particles.append({
            'x': random.randint(30, width - 30),
            'y': random.randint(30, height - 30),
            'r': random.uniform(1.0, 2.5),
            'speed': random.uniform(0.1, 0.4),
            'phase': random.uniform(0, 2 * math.pi)
        })
        
    for i in range(num_frames):
        # 1. Create canvas with dark background
        img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 2. Draw glassmorphic background card
        margin = 15 * scale
        card_coords = [margin, margin, sw - margin, sh - margin]
        card_radius = 24 * scale
        
        # Draw card body (semi-transparent dark blue/gray)
        draw.rounded_rectangle(card_coords, radius=card_radius, fill=(10, 10, 22, 245))
        
        # Draw glowing borders (Neon Teal)
        border_color = (0, 212, 170, 90)
        draw.rounded_rectangle(card_coords, radius=card_radius, outline=border_color, width=int(1.5 * scale))
        
        # 3. Draw drifting glowing particles (Space Dust)
        for p in particles:
            # Shift Y coordinate slowly over time and apply sin wave horizontal drift
            drift_y = (p['y'] - i * p['speed'] * 2) % (height - 60) + 30
            drift_x = p['x'] + 8 * math.sin(i * 0.1 + p['phase'])
            
            px = int(drift_x * scale)
            py = int(drift_y * scale)
            pr = int(p['r'] * scale)
            
            # Draw particle as soft glowing circle
            alpha = int(100 + 80 * math.sin(i * 0.15 + p['phase']))
            draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(0, 212, 170, alpha))
            
        # 4. Paste icon in the center
        cx, cy = sw // 2, sh // 2 - 25 * scale
        if icon:
            ix, iy = icon.size
            img.paste(icon, (cx - ix // 2, cy - iy // 2), icon)
            
        # 5. Draw concentric dual-direction neon loader rings
        # Clockwise Inner Ring
        angle_cw = (i / num_frames) * 360
        r_inner = 58 * scale
        box_inner = [cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner]
        draw.arc(box_inner, start=angle_cw, end=angle_cw + 260, fill=(0, 212, 170, 255), width=int(2.5 * scale))
        
        # Counter-Clockwise Outer Ring
        angle_ccw = 360 - ((i / num_frames) * 360)
        r_outer = 72 * scale
        box_outer = [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer]
        draw.arc(box_outer, start=angle_ccw, end=angle_ccw + 240, fill=(26, 115, 232, 230), width=int(2 * scale))
        
        # 6. Text Slideshow with smooth fade transitions
        # Determine current text slide
        # Slide 1: 0-19 frames, Slide 2: 20-39 frames, Slide 3: 40-59 frames
        slide_num = i // 20
        slide_frame = i % 20
        
        slides = [
            "🔒 End-to-End Encrypted (AES-256)",
            "⚡ Crystal Clear 1080p Screen Share",
            "👑 Permanent Premium VIP Member"
        ]
        
        text = slides[slide_num]
        
        # Calculate fade-in / fade-out alpha values
        # Frame 0-3: fade in, 4-15: solid, 16-19: fade out
        if slide_frame < 4:
            alpha_scale = (slide_frame + 1) / 4.0
        elif slide_frame > 15:
            alpha_scale = (20 - slide_frame) / 4.0
        else:
            alpha_scale = 1.0
            
        pulse_alpha = int(255 * alpha_scale)
        text_color = (0, 212, 170, pulse_alpha)
        
        # Draw text at bottom
        try:
            font = ImageFont.load_default(size=14 * scale)
        except:
            font = ImageFont.load_default()
            
        try:
            text_bbox = draw.textbbox((0, 0), text, font=font)
            text_w = text_bbox[2] - text_bbox[0]
        except:
            text_w = 150 * scale
            
        draw.text((cx - text_w // 2, sh - 65 * scale), text, fill=text_color, font=font)
        
        # 7. Downsample frame using LANCZOS filter for supreme anti-aliasing
        frame_resized = img.resize((width, height), Image.Resampling.LANCZOS)
        frames.append(frame_resized)
        
    # Save as highly optimized loopable GIF
    output_path = os.path.join("assets", "installing.gif")
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=33, # 33ms per frame = ~30 FPS
        loop=0,
        optimize=True
    )
    print(f"Successfully generated premium slideshow loader GIF at: {output_path}")

if __name__ == "__main__":
    create_loader_gif()
