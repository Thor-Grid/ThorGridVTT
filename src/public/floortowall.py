# Thor-Grid Dungeon Generator v9 - Advanced Features
# Adds varied corridors, room features, traps, and secret doors.

import random
import json
import os

# ==============================================================================
# --- CONFIGURATION & CONSTANTS ---
# ==============================================================================

# Define internal tile types for the generator's logic
VOID = 0
FLOOR = 1
WALL = 2

# --- MONSTER MANUAL (can be expanded) ---
# Initiative is now a bonus to be added to a d20 roll.
MONSTER_MANUAL = [
    {
        "name": "Hill Giant", "size": 3, "imageUrl": "images/hill_giant.png",
        "hit_dice": "10d12+40", "ac": 13, "initiative_bonus": -1, "sightRadius": 60
    },
    {
        "name": "Orc War Chief", "size": 1, "imageUrl": "images/orc_chief.jpg",
        "hit_dice": "11d8+44", "ac": 16, "initiative_bonus": 1, "sightRadius": 60
    },
    {
        "name": "Goblin Sneak", "size": 1, "imageUrl": "images/goblin.png",
        "hit_dice": "2d6", "ac": 15, "initiative_bonus": 3, "sightRadius": 60
    },
    {
        "name": "Clay Golem", "size": 2, "imageUrl": "images/clay_golem.jpg",
        "hit_dice": "9d10+36", "ac": 14, "initiative_bonus": -2, "sightRadius": 60
    },
    {
        "name": "Ogre", "size": 2, "imageUrl": "images/ogre.png",
        "hit_dice": "7d10+21", "ac": 11, "initiative_bonus": -1, "sightRadius": 60
    },
    {
        "name": "Adherer", "size": 1, "imageUrl": "images/Adherer.jpg",
        "hit_dice": "5d8+10", "ac": 14, "initiative_bonus": 1, "sightRadius": 60
    },
    {
        "name": "Athasian Sloth", "size": 2, "imageUrl": "images/Athasian_Sloth.jpg",
        "hit_dice": "8d10+32", "ac": 12, "initiative_bonus": -2, "sightRadius": 60
    },
    {
        "name": "Beholder", "size": 2, "imageUrl": "images/Beholder.jpg",
        "hit_dice": "11d10+44", "ac": 18, "initiative_bonus": 2, "sightRadius": 120
    },
    {
        "name": "Carrion Crawler", "size": 2, "imageUrl": "images/Carrion_Crawler.jpg",
        "hit_dice": "6d10+18", "ac": 13, "initiative_bonus": 1, "sightRadius": 60
    },
    {
        "name": "Chitin Golem", "size": 2, "imageUrl": "images/Chitin_Golem.jpg",
        "hit_dice": "10d10+40", "ac": 17, "initiative_bonus": -1, "sightRadius": 60
    },
    {
        "name": "Cistern Fiend", "size": 2, "imageUrl": "images/Cistern_Fiend.jpg",
        "hit_dice": "7d10+21", "ac": 15, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Desert Centaur", "size": 2, "imageUrl": "images/Desert_Centar.jpg",
        "hit_dice": "6d10+12", "ac": 12, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Draconian", "size": 1, "imageUrl": "images/Draconian.jpg",
        "hit_dice": "4d8+8", "ac": 15, "initiative_bonus": 1, "sightRadius": 60
    },
    {
        "name": "Female Elf", "size": 1, "imageUrl": "images/Female_Elf.jpg",
        "hit_dice": "5d8+5", "ac": 14, "initiative_bonus": 3, "sightRadius": 60
    },
    {
        "name": "Forest Spirit", "size": 1, "imageUrl": "images/Forest_Spirit.jpg",
        "hit_dice": "6d8+12", "ac": 13, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Gelatinous Cube", "size": 2, "imageUrl": "images/Gelatinous_Cube.jpg",
        "hit_dice": "9d10+36", "ac": 6, "initiative_bonus": -3, "sightRadius": 60
    },
    {
        "name": "Ghost", "size": 1, "imageUrl": "images/Ghost.jpg",
        "hit_dice": "7d8", "ac": 11, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Harpy", "size": 1, "imageUrl": "images/Harpy.jpg",
        "hit_dice": "6d8+6", "ac": 11, "initiative_bonus": 1, "sightRadius": 60
    },
    {
        "name": "Kirre", "size": 2, "imageUrl": "images/Kirre.jpg",
        "hit_dice": "7d10+14", "ac": 14, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Male Elf", "size": 1, "imageUrl": "images/Male_Elf.jpg",
        "hit_dice": "5d8+5", "ac": 15, "initiative_bonus": 3, "sightRadius": 60
    },
    {
        "name": "Male Gnome", "size": 1, "imageUrl": "images/Male_Gnome.jpg",
        "hit_dice": "4d6+4", "ac": 13, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Rastipede", "size": 2, "imageUrl": "images/Rastipede.jpg",
        "hit_dice": "8d10+24", "ac": 16, "initiative_bonus": 0, "sightRadius": 60
    },
    {
        "name": "Stellar Dragon", "size": 3, "imageUrl": "images/Stellar_Dragon.jpg",
        "hit_dice": "15d12+75", "ac": 19, "initiative_bonus": 0, "sightRadius": 120
    },
    {
        "name": "Storm Giant", "size": 3, "imageUrl": "images/Storm_Giant.jpg",
        "hit_dice": "16d12+80", "ac": 16, "initiative_bonus": 2, "sightRadius": 60
    },
    {
        "name": "Vampire", "size": 1, "imageUrl": "images/Vampire1.jpg",
        "hit_dice": "12d8+48", "ac": 16, "initiative_bonus": 4, "sightRadius": 120
    },
    {
        "name": "Zombies", "size": 1, "imageUrl": "images/Zombies.jpg",
        "hit_dice": "3d8+9", "ac": 8, "initiative_bonus": -2, "sightRadius": 60
    }
]

# ==============================================================================
# --- CORE CLASSES & HELPER FUNCTIONS ---
# ==============================================================================

class Rectangle:
    """A rectangle on the map, used to represent rooms."""
    def __init__(self, x, y, w, h):
        self.x1, self.y1 = x, y
        self.x2, self.y2 = x + w, y + h

    def center(self):
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)

    def intersects(self, other):
        # Returns true if this rectangle intersects with another one (with a buffer)
        return (self.x1 <= other.x2 + 2 and self.x2 >= other.x1 - 2 and
                self.y1 <= other.y2 + 2 and self.y2 >= other.y1 - 2)

def roll_hit_dice(dice_string):
    """Parses a dice string like '2d6' or '10d12+40' and returns the result."""
    total, bonus = 0, 0
    if '+' in dice_string:
        dice_part, bonus_part = dice_string.split('+')
        bonus = int(bonus_part)
    else:
        dice_part = dice_string
    num_dice, die_type = [int(p) for p in dice_part.split('d')]
    for _ in range(num_dice):
        total += random.randint(1, die_type)
    return total + bonus

# --- MODIFIED: Added prompts for new features ---
def get_user_settings():
    """Gets all the generation parameters from the user."""
    settings = {}
    print("--- Thor-Grid Dungeon Generator (v9 - Advanced Features) ---")
    
    def get_int_input(prompt, default, min_val=0, max_val=1000):
        while True:
            user_input = input(f"{prompt} [default: {default}]: ")
            if not user_input: return default
            try:
                val = int(user_input)
                if min_val <= val <= max_val: return val
                else: print(f"Please enter a number between {min_val} and {max_val}.")
            except ValueError: print("Invalid input. Please enter a whole number.")
            
    print("\n--- Basic Layout ---")
    settings['width'] = get_int_input("Grid Width", 80, 20)
    settings['height'] = get_int_input("Grid Height", 60, 20)
    settings['max_rooms'] = get_int_input("Number of Rooms", 10, 2)
    settings['min_size'] = get_int_input("Min Room Size", 6, 4)
    settings['max_size'] = get_int_input("Max Room Size", 12, 4)
    
    print("\n--- Dungeon Content ---")
    settings['num_encounters'] = get_int_input("Number of Monster Encounter Rooms", 4, 0)
    settings['min_monsters'] = get_int_input("Min monsters per encounter", 1, 1)
    settings['max_monsters'] = get_int_input("Max monsters per encounter", 4, 1)
    settings['num_treasures'] = get_int_input("Number of Treasures", 2, 0)
    
    print("\n--- Advanced Features ---")
    settings['door_probability'] = get_int_input("Door Chance %", 80, 0, 100) / 100.0
    settings['wide_corridor_chance'] = get_int_input("Wide Corridor Chance %", 20, 0, 100) / 100.0
    settings['cavern_chance'] = get_int_input("Jagged Corridor (Cavern) Chance %", 15, 0, 100) / 100.0
    settings['room_feature_chance'] = get_int_input("Room Feature (Pillars/Pools) Chance %", 40, 0, 100) / 100.0
    settings['num_traps'] = get_int_input("Number of Traps", 3, 0)
    settings['num_secret_doors'] = get_int_input("Number of Secret Doors", 2, 0)


    filename_input = input("\nEnter output filename [default: advanced_dungeon.json]: ")
    settings['filename'] = filename_input or 'advanced_dungeon.json'
    if not settings['filename'].endswith('.json'): settings['filename'] += '.json'
    return settings

# --- NEW: Helper function to add features to a single room ---
def add_room_features(room, grid, tokens, settings):
    """Adds pillars or pools to a given room based on chance."""
    if random.random() > settings['room_feature_chance']:
        return

    # Ensure the room is large enough for features
    if room.x2 - room.x1 < 5 or room.y2 - room.y1 < 5:
        return

    feature = random.choice(['pillars', 'pool'])

    if feature == 'pillars':
        # Add 2-4 pillars, avoiding the very center and edges
        for _ in range(random.randint(2, 4)):
            # Place pillar within the inner part of the room
            px = random.randint(room.x1 + 1, room.x2 - 2)
            py = random.randint(room.y1 + 1, room.y2 - 2)
            # Make sure not to block the center, which might be used for start/exit points
            if (px, py) != room.center():
                grid[py][px] = WALL

    elif feature == 'pool':
        # Create a pool token in the center of a sub-rectangle of the room
        pool_w = random.randint(2, room.x2 - room.x1 - 2)
        pool_h = random.randint(2, room.y2 - room.y1 - 2)
        pool_x = random.randint(room.x1 + 1, room.x2 - 1 - pool_w)
        pool_y = random.randint(room.y1 + 1, room.y2 - 1 - pool_h)
        tokens.append({
            "name": "Pool", "x": pool_x, "y": pool_y,
            "size": max(pool_w, pool_h), # VTT token size
            "backgroundColor": "dodgerblue", "owner": "DM"
        })

# --- NEW: Helper function to place traps and secret doors ---
def place_extras(rooms, all_path_tiles, grid, tokens, settings):
    """Places traps and secret doors on the map."""
    # Place Traps
    print("Placing traps...")
    available_floor = list(all_path_tiles)
    for room in rooms:
        for y in range(room.y1, room.y2):
            for x in range(room.x1, room.x2):
                available_floor.append((x, y))
    
    random.shuffle(available_floor)
    for _ in range(settings['num_traps']):
        if not available_floor: break
        x, y = available_floor.pop()
        tokens.append({
            "name": "Trap", "x": x, "y": y, "size": 1,
            "backgroundColor": "crimson", "owner": "DM"
        })

    # Place Secret Doors
    print("Placing secret doors...")
    potential_secret_door_walls = []
    for y in range(1, settings['height'] - 1):
        for x in range(1, settings['width'] - 1):
            if grid[y][x] == WALL:
                # Check for a wall separating two floor areas (horizontally or vertically)
                if (grid[y][x-1] == FLOOR and grid[y][x+1] == FLOOR) or \
                   (grid[y-1][x] == FLOOR and grid[y+1][x] == FLOOR):
                    continue # This is a normal door or a 1-tile thick wall, not a good secret door spot
                
                # Look for a wall with floor on one side and another wall on the other
                if (grid[y][x-1] == FLOOR and grid[y][x+1] == WALL) or \
                   (grid[y][x+1] == FLOOR and grid[y][x-1] == WALL) or \
                   (grid[y-1][x] == FLOOR and grid[y+1][x] == WALL) or \
                   (grid[y+1][x] == FLOOR and grid[y-1][x] == WALL):
                    potential_secret_door_walls.append((x, y))

    random.shuffle(potential_secret_door_walls)
    for _ in range(settings['num_secret_doors']):
        if not potential_secret_door_walls: break
        x, y = potential_secret_door_walls.pop()
        tokens.append({
            "name": "Secret Door", "x": x, "y": y, "size": 1,
            "backgroundColor": "dimgray", "owner": "DM"
        })


# ==============================================================================
# --- DUNGEON GENERATION LOGIC ---
# ==============================================================================

def generate_and_save_dungeon(settings):
    """Main function to generate and save the dungeon."""
    
    grid = [[VOID for _ in range(settings['width'])] for _ in range(settings['height'])]
    rooms = []
    print("\nPlacing room blueprints...")

    # (Room placement logic is unchanged)
    max_attempts = settings['max_rooms'] * 20
    attempts = 0
    while len(rooms) < settings['max_rooms'] and attempts < max_attempts:
        w = random.randint(settings['min_size'], settings['max_size'])
        h = random.randint(settings['min_size'], settings['max_size'])
        x = random.randrange(1, settings['width'] - w - 1)
        y = random.randrange(1, settings['height'] - h - 1)
        new_room = Rectangle(x, y, w, h)
        if not any(new_room.intersects(other) for other in rooms):
            rooms.append(new_room)
        attempts += 1

    if len(rooms) < 2:
        print(f"Error: Only placed {len(rooms)} rooms.")
        return

    print(f"Successfully placed {len(rooms)} rooms.")
    
    print("Building rooms...")
    for room in rooms:
        for y in range(room.y1, room.y2):
            for x in range(room.x1, room.x2):
                grid[y][x] = FLOOR
        for y in range(room.y1 - 1, room.y2 + 1):
            for x in range(room.x1 - 1, room.x2 + 1):
                if 0 <= y < settings['height'] and 0 <= x < settings['width'] and grid[y][x] == VOID:
                    grid[y][x] = WALL

    # --- MODIFIED: Corridor carving logic to allow for different styles ---
    print("Carving corridors and placing doors...")
    door_locations = set()
    all_path_tiles = set()
    rooms.sort(key=lambda r: r.center()[0])

    for i in range(len(rooms) - 1):
        prev_cx, prev_cy = rooms[i].center()
        new_cx, new_cy = rooms[i+1].center()
        
        # Decide corridor style for this connection
        style_roll = random.random()
        corridor_style = 'normal'
        if style_roll < settings['cavern_chance']:
            corridor_style = 'cavern'
        elif style_roll < settings['cavern_chance'] + settings['wide_corridor_chance']:
            corridor_style = 'wide'
            
        path = []
        # Get the L-shaped path coordinates
        if random.randint(0, 1) == 1: # Horizontal then vertical
            h_path = [(x, prev_cy) for x in range(min(prev_cx, new_cx), max(prev_cx, new_cx) + 1)]
            v_path = [(new_cx, y) for y in range(min(prev_cy, new_cy), max(prev_cy, new_cy) + 1)]
        else: # Vertical then horizontal
            v_path = [(prev_cx, y) for y in range(min(prev_cy, new_cy), max(prev_cy, new_cy) + 1)]
            h_path = [(x, new_cy) for x in range(min(prev_cx, new_cx), max(prev_cx, new_cx) + 1)]
        
        # Apply style to path
        if corridor_style == 'wide':
            for x, y in h_path: path.extend([(x, y), (x, y + 1)])
            for x, y in v_path: path.extend([(x, y), (x + 1, y)])
        elif corridor_style == 'cavern':
            for x, y in h_path: path.append((x, y + random.randint(-1, 1)))
            for x, y in v_path: path.append((x + random.randint(-1, 1), y))
            path = list(dict.fromkeys(path)) # Remove duplicates
        else: # normal
            path.extend(h_path)
            path.extend(v_path)
        
        # Carve path and place doors
        for px, py in path:
            if 0 <= px < settings['width'] and 0 <= py < settings['height']:
                if grid[py][px] == WALL and random.random() < settings['door_probability']:
                    door_locations.add((px, py))
                grid[py][px] = FLOOR
                all_path_tiles.add((px, py))

    print("Building corridor walls...")
    for px, py in all_path_tiles:
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                if dx == 0 and dy == 0: continue
                nx, ny = px + dx, py + dy
                if 0 <= nx < settings['width'] and 0 <= ny < settings['height'] and grid[ny][nx] == VOID:
                    grid[ny][nx] = WALL
    
    tokens = [] # Initialize tokens list earlier for feature functions
    
    # --- NEW: Call the function to add features to rooms ---
    print("Adding features to rooms...")
    for room in rooms:
        add_room_features(room, grid, tokens, settings)
    
    # --- Prepare final JSON data ---
    thor_grid_walls = [[1 if cell == WALL else 0 for cell in row] for row in grid]
    
    # (Placement of Start/Exit and monsters is mostly unchanged)
    rooms.sort(key=lambda r: r.center()[0])
    start_room, end_room = rooms[0], rooms[-1]
    
    x, y = start_room.center()
    tokens.append({"name": "Start", "x": x, "y": y, "backgroundColor": "lime", "size": 1})
    x, y = end_room.center()
    tokens.append({"name": "Exit", "x": x, "y": y, "backgroundColor": "yellow", "size": 1})

    for x, y in door_locations:
        tokens.append({"name": "Door", "x": x, "y": y, "backgroundColor": "saddlebrown", "size": 1})
        
    available_rooms = [r for r in rooms if r != start_room and r != end_room]
    random.shuffle(available_rooms)
    monster_counts = {}
    
    print("Placing monsters...")
    # (Monster placement logic is unchanged)
    for _ in range(settings['num_encounters']):
        if not available_rooms or not MONSTER_MANUAL: break
        room_for_encounter = available_rooms.pop()
        room_w = room_for_encounter.x2 - room_for_encounter.x1
        room_h = room_for_encounter.y2 - room_for_encounter.y1
        eligible_monsters = [m for m in MONSTER_MANUAL if m['size'] <= room_w and m['size'] <= room_h]
        if not eligible_monsters:
            print(f"  - Warning: Skipping room, too small for any available monsters.")
            continue
        num_monsters_to_place = random.randint(settings['min_monsters'], settings['max_monsters'])
        potential_start_points = []
        for ry in range(room_for_encounter.y1, room_for_encounter.y2):
            for rx in range(room_for_encounter.x1, room_for_encounter.x2):
                if grid[ry][rx] == FLOOR: # Only place on floor tiles
                    potential_start_points.append((rx, ry))
        random.shuffle(potential_start_points)
        placed_in_room = 0
        occupied_in_room = set()
        for start_x, start_y in potential_start_points:
            if placed_in_room >= num_monsters_to_place: break
            monster_template = random.choice(eligible_monsters)
            monster_size = monster_template.get('size', 1)
            if start_x + monster_size > room_for_encounter.x2 or start_y + monster_size > room_for_encounter.y2: continue
            is_valid_spot = True
            required_tiles = set()
            for y_offset in range(monster_size):
                for x_offset in range(monster_size):
                    tile = (start_x + x_offset, start_y + y_offset)
                    if tile in occupied_in_room or grid[tile[1]][tile[0]] != FLOOR:
                        is_valid_spot = False
                        break
                    required_tiles.add(tile)
                if not is_valid_spot: break
            if is_valid_spot:
                monster_token = monster_template.copy()
                base_name = monster_token['name']
                monster_counts[base_name] = monster_counts.get(base_name, 0) + 1
                monster_token['name'] = f"{base_name} {monster_counts[base_name]}"
                rolled_hp = roll_hit_dice(monster_token['hit_dice'])
                monster_token['hp'], monster_token['maxHP'] = rolled_hp, rolled_hp
                rolled_initiative = random.randint(1, 20) + monster_token['initiative_bonus']
                monster_token['initiative'] = rolled_initiative
                del monster_token['hit_dice'], monster_token['initiative_bonus']
                monster_token['x'], monster_token['y'] = start_x, start_y
                monster_token['owner'] = 'DM'
                tokens.append(monster_token)
                occupied_in_room.update(required_tiles)
                placed_in_room += 1
    
    print("Placing treasure...")
    for _ in range(settings['num_treasures']):
        if not available_rooms: break
        room = available_rooms.pop()
        # Find a valid floor tile that isn't occupied
        treasure_placed = False
        for _ in range(10): # Try 10 times to find a spot
            tx, ty = random.randint(room.x1, room.x2-1), random.randint(room.y1, room.y2-1)
            if grid[ty][tx] == FLOOR:
                tokens.append({"name": "Treasure", "x": tx, "y": ty, "backgroundColor": "gold", "size": 1})
                treasure_placed = True
                break
        if not treasure_placed: # Fallback to center
            x, y = room.center()
            tokens.append({"name": "Treasure", "x": x, "y": y, "backgroundColor": "gold", "size": 1})

    # --- NEW: Call the function to place traps and secret doors ---
    place_extras(rooms, all_path_tiles, grid, tokens, settings)

    output_data = {
      "tokens": tokens, 
      "walls": thor_grid_walls, 
      "isGridVisible": True, 
      "isMapFullyVisible": False, 
      "backgroundImageUrl": "",
      "gridSize": {"width": settings['width'], "height": settings['height']}, 
      "version": "vtt-advanced-features-1.0"
    }

    desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
    output_dir = os.path.join(desktop_path, 'VTT_Dungeons')
    os.makedirs(output_dir, exist_ok=True)
    full_output_path = os.path.join(output_dir, settings['filename'])
    try:
        with open(full_output_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\nSuccess! Dungeon saved to 'VTT_Dungeons' on your Desktop:\n{full_output_path}")
    except IOError as e:
        print(f"\nError: Could not write file '{full_output_path}'. Reason: {e}")

# ==============================================================================
# --- MAIN EXECUTION ---
# ==============================================================================

if __name__ == "__main__":
    try:
        user_settings = get_user_settings()
        if user_settings:
            generate_and_save_dungeon(user_settings)
    except KeyboardInterrupt:
        print("\n\nGeneration cancelled by user.")
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")
    finally:
        input("\nPress Enter to exit.")