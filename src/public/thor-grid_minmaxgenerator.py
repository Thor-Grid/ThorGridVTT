import random
import json
import os

# ==============================================================================
# --- THE MONSTER MANUAL & IMAGE SETUP ---
# ==============================================================================
MONSTER_MANUAL = [
    {
        "name": "Hill Giant", "size": 3, "imageUrl": "images/hill_giant.png",
        "maxHP": 105, "hp": 105, "ac": 13, "initiative": 8, "sightRadius": 60
    },
    {
        "name": "Orc War Chief", "size": 1, "imageUrl": "images/orc_chief.jpg",
        "maxHP": 93, "hp": 93, "ac": 16, "initiative": 12, "sightRadius": 60
    },
    {
        "name": "Goblin Sneak", "size": 1, "imageUrl": "images/goblin.png",
        "maxHP": 7, "hp": 7, "ac": 15, "initiative": 16, "sightRadius": 60
    },
    {
        "name": "Ogre", "size": 2, "imageUrl": "images/ogre.png",
        "maxHP": 59, "hp": 59, "ac": 11, "initiative": 8, "sightRadius": 60
    }
]

# (The rest of the script is the same until the settings and generation functions)
TOKEN_START, TOKEN_EXIT, TOKEN_TREASURE = '>', '<', '$'
NUM_TREASURES = 2
WALL, FLOOR = '#', '.'

class Rectangle:
    def __init__(self, x, y, w, h): self.x1, self.y1, self.x2, self.y2 = x, y, x + w, y + h
    def center(self): return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)
    def intersects(self, other): return (self.x1 <= other.x2 and self.x2 >= other.x1 and self.y1 <= other.y2 and self.y2 >= other.y1)

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
    settings = {}; print("--- Thor-Grid Final Encounter Generator (v5 - Min/Max Rooms) ---")
    print("This version lets you set a minimum number of rooms.\n")
    def get_int_input(prompt, default):
        while True:
            user_input = input(f"{prompt} [default: {default}]: ")
            if user_input == '': return default
            try:
                val = int(user_input);
                if val >= 0: return val
                else: print("Please enter a non-negative number.")
            except ValueError: print("Invalid input. Please enter a whole number.")
    settings['width'] = get_int_input("Grid Width", 70)
    settings['height'] = get_int_input("Grid Height", 40)
    # NEW: Min rooms setting
    settings['min_rooms'] = get_int_input("Min Rooms to Generate", 6)
    settings['max_rooms'] = get_int_input("Max Rooms to Generate", 10)
    settings['min_size'] = get_int_input("Min Room Size", 6)
    settings['max_size'] = get_int_input("Max Room Size", 10)
    settings['num_encounters'] = get_int_input("Number of Monster Encounters", 3)
    settings['num_treasures'] = get_int_input("Number of Treasures", NUM_TREASURES)
    filename_input = input("Enter output filename [default: final_dungeon.json]: ")
    settings['filename'] = filename_input or 'final_dungeon.json'
    if not settings['filename'].endswith('.json'): settings['filename'] += '.json'
    return settings

# --- UPDATED generate_and_save_dungeon FUNCTION ---
def generate_and_save_dungeon(settings):
    # (The dungeon generation logic at the start is the same)
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
    rooms.sort(key=lambda r: r.x1)
    for i, room in enumerate(rooms):
        create_room_solid(grid, room)
        if i > 0:
            prev_x, prev_y = rooms[i-1].center(); new_x, new_y = room.center()
            if random.randint(0, 1) == 1: create_h_tunnel(grid, prev_x, new_x, prev_y); create_v_tunnel(grid, prev_y, new_y, new_x)
            else: create_v_tunnel(grid, prev_y, new_y, prev_x); create_h_tunnel(grid, prev_x, new_x, new_y)

    # (Token placement logic is the same)
    thor_grid_walls = [[1 if cell == WALL else 0 for cell in row] for row in grid]
    tokens = []
    start_room = rooms[0]; x, y = start_room.center(); tokens.append({"name": "Start", "x": x, "y": y, "backgroundColor": "lime", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0})
    end_room = rooms[-1]; x, y = end_room.center(); tokens.append({"name": "Exit", "x": x, "y": y, "backgroundColor": "yellow", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0})
    available_rooms = rooms[1:-1]; random.shuffle(available_rooms)
    for _ in range(settings['num_encounters']):
        if not available_rooms or not MONSTER_MANUAL: break
        room, monster_template = available_rooms.pop(), random.choice(MONSTER_MANUAL)
        monster_token = monster_template.copy(); spawn_x, spawn_y = room.center()
        monster_token['x'], monster_token['y'] = spawn_x, spawn_y; monster_token['backgroundColor'] = None
        monster_token.setdefault('rotation', 0); monster_token.setdefault('isMinion', False); monster_token.setdefault('owner', 'DM')
        monster_token['imageUrl'] = monster_token['imageUrl'].replace(os.path.sep, '/'); tokens.append(monster_token)
    for _ in range(settings['num_treasures']):
        if not available_rooms: break
        room = available_rooms.pop(); x, y = room.center(); tokens.append({"name": "Treasure", "x": x, "y": y, "backgroundColor": "gold", "imageUrl": None, "maxHP": 0, "hp": 0, "ac": 0, "initiative": 0})
    
    output_data = {
      "tokens": tokens, "walls": thor_grid_walls, "isGridVisible": True, "isMapFullyVisible": False, "backgroundImageUrl": "",
      "gridSize": {"width": settings['width'], "height": settings['height']}, "version": "1.0-zip"
    }

    # --- THIS IS THE MODIFIED PART ---
    # Create a 'VTT_Dungeons' folder on your Desktop to store the output
    desktop_path = os.path.join(os.path.expanduser('~'), 'Desktop')
    output_dir = os.path.join(desktop_path, 'VTT_Dungeons')
    os.makedirs(output_dir, exist_ok=True) # Creates the folder if it doesn't exist

    full_output_path = os.path.join(output_dir, settings['filename'])
    # --- END OF MODIFICATION ---

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