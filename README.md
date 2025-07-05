ThorGridVTT has evolved significantly since its initial release. What started as a lightweight map-and-token tool has grown into a feature-rich virtual tabletop with a powerful dice roller, dynamic fog of war, and cross-platform support.

---

### **Downloads**
*   **[Download the User Guide (PDF)](https://github.com/Thor-Grid/ThorGridVTT/blob/main/Thor-Grid%20User%20Guide.pdf)**
*   **[Go to the Latest Release](https://github.com/Thor-Grid/ThorGridVTT/releases/latest)**

---

## Version History

### **v3.3.x - The Context Menu & Portability Revolution**

This series of updates focuses on major quality-of-life improvements for the DM, streamlining token management and enhancing session portability.

*   **v3.3.3 (Latest): Full Token Context Menu**
    *   **Right-click (or long-press) a token** to open a comprehensive editing menu directly on the map.
    *   DMs can instantly edit a token's **Name, Image URL, HP, AC, Initiative, Rotation, Sight, and Light Source properties**.
    *   A new **"Browse..." button** allows DMs using the desktop app to select local image files from their computer.
    *   **Full Image Portability:** Local images added via the "Browse..." button are now correctly packaged into the `.zip` save file, making sessions fully portable.
    *   DMs can now **click any dice roll result in the log** to apply that number as damage to the selected token.

*   **v3.3.2: The Living Dungeon Update**
    *   **Dungeon Generator Overhaul**: The core generation logic was rewritten for stability and to support a host of new features that bring dungeons to life.
    *   **Varied Corridor Styles**: Added support for standard, wide, and jagged/cavernous corridor styles.
    *   **Dynamic Room Features**: Rooms can now be generated with tactical elements like pillars and pools of water.
    *   **Secrets & Dangers**: The generator can now automatically place hidden traps and secret doors for the DM.
    *   **Enhanced User Control**: The generator prompts the user to set the probability for all new features, allowing for full customization.
    *   **Critical Bug Fixes**: Resolved major bugs including failed corridor generation and the "trail of doors" issue.

### **v3.1.x - The Dice Roller & DM Tools**

This major version introduced a complete dice rolling system, transforming ThorGridVTT into a more comprehensive VTT solution.

*   **v3.1.1: Sound for Dice Rolls**
    *   An audible sound now plays for all users when dice are rolled, providing a clear audio cue for actions.
*   **v3.1.0: DM Hidden Rolls**
    *   The Game Master can now make "hidden" dice rolls. A toggle in the dice roller hides the results from players while keeping them visible to the DM, perfect for secret checks and suspense.
*   **v3.0.0: The Dice Roller Revolution**
    *   Introduced a full-featured dice roller supporting complex formulas like `2d20kh1` (advantage), `2d20kl1` (disadvantage), and modifiers like `5d8+5`.

### **v2.x - Building the Modern VTT Experience**

This series of releases laid the foundation for modern VTT functionality, focusing on immersion, game management, and quality-of-life improvements.

*   **v2.2.0: Dynamic Vision & Walls**
    *   A game-changing update that added **Wall Collision**. Tokens are now stopped by drawn walls, increasing immersion.
    *   The vision system was enhanced, allowing players to only see walls they are adjacent to, building upon the Fog of War system.
*   **v2.1.2 - v2.1.9: Fog of War & Combat Stats**
    *   The initial **Fog of War** system was implemented, obscuring the map from the players' view based on token vision and light sources.
    *   Tokens were updated to display key **Combat Stats** like HP, making it easier to track combat status at a glance.
*   **Quality of Life & Platform Support (v2.1 - v2.2.8)**
    *   **Linux Support:** Official `.deb` installers were introduced for Debian/Ubuntu based systems.
    *   **UI/UX Toggles:** Added toggle buttons to easily show/hide the entire map or the gridlines for all players.
    *   **Compressed Game Saves:** The export/import function was upgraded to handle large save states using `.zip` compression.
    *   **Custom Scene Size:** Added the ability to define a custom scene size for your maps.
    *   Numerous bug fixes and stability improvements.

### **v1.x - The Foundation**

The initial versions of ThorGridVTT established the essential "map and token" tools for basic gameplay.

*   **v1.0.4 - v1.0.6: Initial Release**
    *   Established the core client/server architecture with distinct DM and Player roles.
    *   Implemented token creation with custom colors or images uploaded from local files.
