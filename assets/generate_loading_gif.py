import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

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
        # Resize to 90x90 at normal scale (270x270 at super-scale)
        icon = icon_orig.resize((90 * scale, 90 * scale), Image.Resampling.LANCZOS)
        
    frames = []
    num_frames = 30
    
    for i in range(num_frames):
        # 1. Create canvas with dark background
        img = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 2. Draw glassmorphic background card
        # Rounded box dimensions
        margin = 15 * scale
        card_coords = [margin, margin, sw - margin, sh - margin]
        card_radius = 24 * scale
        
        # Draw card body (semi-transparent dark blue/gray)
        draw.rounded_rectangle(card_coords, radius=card_radius, fill=(13, 13, 27, 240))
        
        # Draw glowing borders
        border_color_start = (0, 212, 170, 100) # Neon Teal
        draw.rounded_rectangle(card_coords, radius=card_radius, outline=border_color_start, width=int(1.5 * scale))
        
        # 3. Paste icon in the center
        cx, cy = sw // 2, sh // 2 - 20 * scale
        if icon:
            ix, iy = icon.size
            img.paste(icon, (cx - ix // 2, cy - iy // 2), icon)
            
        # 4. Draw spinning neon loader ring
        angle = (i / num_frames) * 360
        ring_radius = 65 * scale
        # Arc bounds
        arc_box = [cx - ring_radius, cy - ring_radius, cx + ring_radius, cy + ring_radius]
        
        # Draw glowing neon teal arc
        draw.arc(arc_box, start=angle, end=angle + 280, fill=(0, 212, 170, 255), width=int(3 * scale))
        # Draw a smaller accent blue dot or arc
        draw.arc(arc_box, start=angle + 290, end=angle + 340, fill=(26, 115, 232, 255), width=int(3 * scale))
        
        # 5. Draw status text at the bottom
        text = "Installing AtikMeet..."
        # Pulsing text color opacity
        pulse_alpha = int(180 + 75 * math.sin((i / num_frames) * 2 * math.pi))
        
        # Fallback text drawing
        text_color = (0, 212, 170, pulse_alpha)
        # Use default font sizing
        try:
            font = ImageFont.load_default(size=14 * scale)
        except:
            font = ImageFont.load_default()
            
        # Centering text
        try:
            text_bbox = draw.textbbox((0, 0), text, font=font)
            text_w = text_bbox[2] - text_bbox[0]
            text_h = text_bbox[3] - text_bbox[1]
        except:
            text_w = 120 * scale
            text_h = 14 * scale
            
        draw.text((cx - text_w // 2, sh - 60 * scale), text, fill=text_color, font=font)
        
        # 6. Downsample frame using LANCZOS filter for supreme anti-aliasing
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
    print(f"Successfully generated premium loading GIF at: {output_path}")

if __name__ == "__main__":
    create_loader_gif()
