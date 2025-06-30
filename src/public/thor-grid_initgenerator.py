# Thor-Grid Dungeon Generator v7 - Dynamic Encounters
# This script generates a dungeon map with dynamic monster encounters, allowing for multiple monsters per room and initiative rolls.
# It includes user-defined settings for room sizes, monster counts, and treasure placement.
# It saves the generated dungeon in a JSON format suitable for virtual tabletop platforms.
# This code is designed to be run in a Python environment with access to the standard libraries.
      
import random
import json
import os

# ==============================================================================
# --- THE MONSTER MANUAL & IMAGE SETUP ---
# ==============================================================================

### --- CHANGE 1 START: Initiative Bonus --- ###
# We've changed the static 'initiative' to 'initiative_bonus'.
# This bonus will be added to a d20 roll for each monster.
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
    }
]
### --- CHANGE 1 END --- ###

# (The Rectangle class and tunnel functions are unchanged)
TOKEN_START, TOKEN_EXIT, TOKEN_TREASURE = '>', '<', '$'
NUM_TREASURES = 2
WALL, FLOOR = '#', '.'

class Rectangle:
    def __init__(self, x, y, w, h): self.x1, self.y1, self.x2, self.y2 = x, y, x + w, y + h
    def center(self): return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)
    def intersects(self, other): return (self.x1 <= other.x2 and self.x2 >= other.x1 and self.y1 <= other.y2 and self.y2 >= other.y1)
    # Helper to get width and height
    def get_wh(self): return (self.x2 - self.x1, self.y2 - self.y1)

# --- Helper Functions ---
# ... a couple lines before ...
def create_v_tunnel(grid, y1, y2, x):
    for y in range(min(y1, y2), max(y1, y2) + 1):
        if 0 <= y < len(grid) and 0 <= x < len(grid[0]): grid[y][x] = FLOOR

### --- THIS IS THE NEW HELPER FUNCTION --- ###
def roll_hit_dice(dice_string):
    """Parses a dice string like '2d6' or '10d12+40' and returns the result."""
    total = 0
    bonus = 0
    
    if '+' in dice_string:
        dice_part, bonus_part = dice_string.split('+')
        bonus = int(bonus_part)
    else:
        dice_part = dice_string

    num_dice, die_type = [int(p) for p in dice_part.split('d')]
    
    for _ in range(num_dice):
        total += random.randint(1, die_type)
        
    return total + bonus
### --- END OF NEW HELPER FUNCTION --- ###

def create_room_solid(grid, room):
    for y in range(room.y1, room.y2):
        for x in range(room.x1, room.x2):
            if 0 <= y < len(grid) and 0 <= x < len(grid[0]): grid[y][x] = FLOOR
def create_h_tunnel(grid, x1, x2, y):
    for x in range(min(x1, x2), max(x1, x2) + 1):
        if 0 <= y < len(grid) and 0 <= x < len(grid[0]): grid[y][x] = FLOOR
def create_v_tunnel(grid, y1, y2, x):
    for y in range(min(y1, y2), max(y1, y2) + 1):
        if 0 <= y < len(grid) and 0 <= x < len(grid[0]): grid[y][x] = FLOOR

# --- UPDATED get_user_settings FUNCTION ---
def get_user_settings():
    settings = {}; print("--- Thor-Grid Final Encounter Generator (v7 - Dynamic Encounters) ---")
    print("This version supports multiple monsters per room and rolled initiative.\n")
    def get_int_input(prompt, default):
        while True:
            user_input = input(f"{prompt} [default: {default}]: ")
            if user_input == '': return default
            try:
                val = int(user_input);
                if val > 0: return val # Most inputs should be positive
                else: print("Please enter a positive number.")
            except ValueError: print("Invalid input. Please enter a whole number.")
    settings['width'] = get_int_input("Grid Width", 80)
    settings['height'] = get_int_input("Grid Height", 50)
    settings['min_rooms'] = get_int_input("Min Rooms to Generate", 8)
    settings['max_rooms'] = get_int_input("Max Rooms to Generate", 12)
    settings['min_size'] = get_int_input("Min Room Size", 6)
    settings['max_size'] = get_int_input("Max Room Size", 12)
    settings['num_encounters'] = get_int_input("Number of Monster Encounter Rooms", 4)
    
    ### --- CHANGE 2 START: User settings for monster counts --- ###
    settings['min_monsters'] = get_int_input("Min monsters per encounter", 1)
    settings['max_monsters'] = get_int_input("Max monsters per encounter", 4)
    if settings['min_monsters'] > settings['max_monsters']:
        print(f"Warning: Min monsters ({settings['min_monsters']}) is greater than max ({settings['max_monsters']}). Setting max to min.")
        settings['max_monsters'] = settings['min_monsters']
    ### --- CHANGE 2 END --- ###
        
    settings['num_treasures'] = get_int_input("Number of Treasures", NUM_TREASURES)
    filename_input = input("Enter output filename [default: final_dungeon.json]: ")
    settings['filename'] = filename_input or 'final_dungeon.json'
    if not settings['filename'].endswith('.json'): settings['filename'] += '.json'
    return settings

# --- UPDATED generate_and_save_dungeon FUNCTION ---
def generate_and_save_dungeon(settings):
    # (Dungeon and room generation is the same as before)
    if settings['min_rooms'] > settings['max_rooms']:
        print(f"Warning: Min rooms ({settings['min_rooms']}) was greater than max rooms ({settings['max_rooms']}). Setting max to min.")
        settings['max_rooms'] = settings['min_rooms']
    grid = [[WALL for _ in range(settings['width'])] for _ in range(settings['height'])]
    rooms = []
    target_room_count = random.randint(settings['min_rooms'], settings['max_rooms'])
    print(f"\nAttempting to generate {target_room_count} rooms...")
    placement_attempts, max_attempts = 0, target_room_count * 20
    while len(rooms) < target_room_count and placement_attempts < max_attempts:
        placement_attempts += 1
        w, h = random.randint(settings['min_size'], settings['max_size']), random.randint(settings['min_size'], settings['max_size'])
        x, y = random.randrange(1, settings['width'] - w - 1), random.randrange(1, settings['height'] - h - 1)
        new_room = Rectangle(x, y, w, h)
        if not any(new_room.intersects(Rectangle(r.x1-1, r.y1-1, r.x2-r.x1+2, r.y2-r.y1+2)) for r in rooms):
            rooms.append(new_room)
    if len(rooms) < settings['min_rooms']:
        print(f"\n--- WARNING ---\nCould not place the minimum required number of rooms ({settings['min_rooms']}).\nOnly placed {len(rooms)} rooms. Try using a larger grid or smaller room sizes.\n-----------------")
        return
    print(f"Successfully placed {len(rooms)} rooms.")
    
    # Create a "snapshot" of the grid when it's all walls, BEFORE any carving.
    grid_before_carving = [row[:] for row in grid]

    # Now, carve the rooms into the main grid.
    for room in rooms:
        create_room_solid(grid, room)

    # Build a network of tunnels using a Minimum Spanning Tree.
    # Helper to calculate squared distance between room centers
    def dist_sq(p1, p2):
        return (p1[0] - p2[0])**2 + (p1[1] - p2[1])**2

    connected = {rooms[0]}
    unconnected = set(rooms[1:])
    while unconnected:
        best_dist = float('inf')
        closest_pair = (None, None)
        for prev_room in connected:
            for new_room in unconnected:
                d = dist_sq(prev_room.center(), new_room.center())
                if d < best_dist:
                    best_dist = d
                    closest_pair = (prev_room, new_room)
        
        prev_room, new_room = closest_pair
        prev_cx, prev_cy = prev_room.center()
        new_cx, new_cy = new_room.center()
        
        if random.randint(0, 1) == 1:
            create_h_tunnel(grid, prev_cx, new_cx, prev_cy)
            create_v_tunnel(grid, prev_cy, new_cy, new_cx)
        else:
            create_v_tunnel(grid, prev_cy, new_cy, prev_cx)
            create_h_tunnel(grid, prev_cx, new_cx, new_cy)

        unconnected.remove(new_room)
        connected.add(new_room)

    # --- Find "Destroyed Wall" Doors that connect rooms to corridors ---
    # 1. Create a master set of all tiles that belong to any room.
    all_room_tiles = set()
    for room in rooms:
        for y_tile in range(room.y1, room.y2):
            for x_tile in range(room.x1, room.x2):
                all_room_tiles.add((x_tile, y_tile))

    # 2. Find doors by checking destroyed walls for neighbors.
    door_locations = set()
    for y in range(settings['height']):
        for x in range(settings['width']):
            # Condition 1 & 2: Was it a wall, but is now a floor?
            if grid_before_carving[y][x] == WALL and grid[y][x] == FLOOR:
                
                is_touching_room = False
                is_touching_corridor = False
                
                # Check all four neighbors of this "destroyed wall" tile.
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= ny < settings['height'] and 0 <= nx < settings['width']:
                        
                        # Is the neighbor a tile that belongs to any room?
                        if (nx, ny) in all_room_tiles:
                            is_touching_room = True
                        
                        ### --- THIS IS THE CRITICAL FIX --- ###
                        # Is the neighbor a floor tile that does NOT belong to any room?
                        elif grid[ny][nx] == FLOOR and (nx, ny) not in all_room_tiles:
                            is_touching_corridor = True

                # A true door MUST touch BOTH a room and a corridor.
                if is_touching_room and is_touching_corridor:
                    door_locations.add((x, y))

                    # I want a single door token unless there is multiple floor all_room_tiles
                    # Count how many adjacent floor tiles in all_room_tiles (i.e., how many room tiles touch this door)
                    adjacent_room_tiles = 0
                    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nx, ny = x + dx, y + dy
                        if (nx, ny) in all_room_tiles:
                            adjacent_room_tiles += 1
                    # Only add a door token if there is exactly one adjacent room tile (i.e., not a double door)
                    if adjacent_room_tiles > 1:
                        continue  # Skip adding a door token for double/multi doors
    # Finally, sort rooms by x-coordinate to determine Start and Exit
    rooms.sort(key=lambda r: r.x1)
    start_room, end_room = rooms[0], rooms[-1]

    thor_grid_walls = [[1 if cell == WALL else 0 for cell in row] for row in grid]
    tokens = []


    # Place Start and Exit tokens
    x, y = start_room.center(); tokens.append({"name": "Start", "x": x, "y": y, "backgroundColor": "lime", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0, "size": 1})
    x, y = end_room.center(); tokens.append({"name": "Exit", "x": x, "y": y, "backgroundColor": "yellow", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0, "size": 1})

    # --- NEW: Create door tokens from the collected locations ---
    for x, y in door_locations:
        tokens.append({"name": "Door", "x": x, "y": y, "backgroundColor": "saddlebrown", "size": 1, "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0})

    available_rooms = rooms[1:-1]; random.shuffle(available_rooms)
    
    ### --- CHANGE 3.1 START: Smarter monster placement logic --- ###
    monster_counts = {}
    print("\nPlacing monster encounters...")
    for _ in range(settings['num_encounters']):
        if not available_rooms or not MONSTER_MANUAL: break
        
        room_for_encounter = available_rooms.pop()
        room_w, room_h = room_for_encounter.get_wh()

        eligible_monsters = [m for m in MONSTER_MANUAL if m['size'] <= room_w and m['size'] <= room_h]
        if not eligible_monsters:
            print(f"  - Warning: Skipping a room at ({room_for_encounter.x1}, {room_for_encounter.y1}) because it's too small for any available monsters.")
            continue

        num_monsters_to_place = random.randint(settings['min_monsters'], settings['max_monsters'])
        print(f"  - Attempting to place {num_monsters_to_place} monster(s) in a room of size {room_w}x{room_h}.")

        # Get all valid floor tiles for this room. We use a set for efficient removal.
        available_spawn_tiles = set()
        for y in range(room_for_encounter.y1, room_for_encounter.y2):
            for x in range(room_for_encounter.x1, room_for_encounter.x2):
                available_spawn_tiles.add((x, y))
        
        # This list will hold potential top-left corners for monsters
        potential_start_points = list(available_spawn_tiles)
        random.shuffle(potential_start_points)

        placed_count = 0
        for _ in range(num_monsters_to_place):
            monster_template = random.choice(eligible_monsters)
            monster_size = monster_template.get('size', 1)
            
            # Try to find a valid spot for this monster
            spot_found = False
            for i, (start_x, start_y) in enumerate(potential_start_points):
                required_tiles = []
                is_valid_spot = True
                
                # Check if the entire monster footprint fits within the available tiles
                for y_offset in range(monster_size):
                    for x_offset in range(monster_size):
                        tile = (start_x + x_offset, start_y + y_offset)
                        if tile not in available_spawn_tiles:
                            is_valid_spot = False
                            break
                        required_tiles.append(tile)
                    if not is_valid_spot:
                        break
                
                # If we found a valid spot, place the monster and reserve its tiles
                if is_valid_spot:
                    monster_token = monster_template.copy()
                    
                    base_name = monster_token['name']
                    monster_counts[base_name] = monster_counts.get(base_name, 0) + 1
                    monster_token['name'] = f"{base_name} {monster_counts[base_name]}"

                    # --- ROLL HP AND INITIATIVE ---
                    rolled_hp = roll_hit_dice(monster_token['hit_dice'])
                    monster_token['hp'] = rolled_hp
                    monster_token['maxHP'] = rolled_hp
                    del monster_token['hit_dice'] # Clean up the template key

                    rolled_initiative = random.randint(1, 20) + monster_token['initiative_bonus']
                    monster_token['initiative'] = rolled_initiative
                    del monster_token['initiative_bonus'] # Clean up the template key
                    # ------------------------------

                    monster_token['x'], monster_token['y'] = start_x, start_y
                    monster_token['backgroundColor'] = None
                    monster_token.setdefault('rotation', 0); monster_token.setdefault('isMinion', False); monster_token.setdefault('owner', 'DM')
                    monster_token['imageUrl'] = monster_token['imageUrl'].replace(os.path.sep, '/')
                    
                    tokens.append(monster_token)
                    
                    # Remove the occupied tiles from future consideration
                    available_spawn_tiles.difference_update(required_tiles)
                    
                    # Also remove them from the list of potential starting points to speed up future checks
                    potential_start_points = [p for p in potential_start_points if p not in required_tiles]
                    
                    spot_found = True
                    placed_count += 1
                    break # Move on to the next monster
            
            if not spot_found:
                # This can happen if the room gets too crowded for the remaining monster sizes
                print(f"    - Warning: Could not find a valid spot for a monster of size {monster_size}x{monster_size}. Room may be full.")

        if placed_count > 0:
            print(f"    -> Successfully placed {placed_count} monster(s).")
        else:
            print(f"    -> Failed to place any monsters in this room.")
    ### --- CHANGE 3.1 END --- ###
            
    # Place treasure
    print("\nPlacing treasure...")
    for _ in range(settings['num_treasures']):
        if not available_rooms: break
        room = available_rooms.pop(); x, y = room.center()
        tokens.append({"name": "Treasure", "x": x, "y": y, "backgroundColor": "gold", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0, "size": 1})
    
    output_data = {
      "tokens": tokens, "walls": thor_grid_walls, "isGridVisible": True, "isMapFullyVisible": False, "backgroundImageUrl": "",
      "gridSize": {"width": settings['width'], "height": settings['height']}, "version": "1.0-zip"
    }

    # (File saving part is the same)
    desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
    output_dir = os.path.join(desktop_path, 'VTT_Dungeons')
    os.makedirs(output_dir, exist_ok=True)
    full_output_path = os.path.join(output_dir, settings['filename'])
    try:
        with open(full_output_path, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\nSuccess! Final encounter map saved to your Desktop in the 'VTT_Dungeons' folder:\n{full_output_path}")
    except IOError as e:
        print(f"\nError: Could not write file '{full_output_path}'. Reason: {e}")

if __name__ == "__main__":
    user_settings = get_user_settings()
    if user_settings:
        generate_and_save_dungeon(user_settings)
    input("\nGeneration complete. Press Enter to exit.")

# This code generates a dungeon map with dynamic monster encounters, including initiative rolls and multiple monsters per room.
# It allows for user-defined settings such as room sizes and monster counts, ensuring a varied and engaging experience for tabletop RPGs.
# The dungeon is saved in a JSON format suitable for virtual tabletop platforms.