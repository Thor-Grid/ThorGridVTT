# ThorGridVTT
ThorGrid a Virtual TableTop (VTT) application - intended to be used in place of large maps and multiple miniatures on tables when playing TTRPGs such as (but not limited to D&D, ShadowRun, ShadowDark, GURPS, and the like)

v1.0.6
  1. Added in a new minor feature in that you can now also have portrait grids as well as the original landscapes with similar dimensions just different orientations

v1.0.5
  1. Was able to work around the odd squirrel behavior that was dumping the program only in AppData with an If statement in main.js to check against if electron launched and making sure it exited the first instance.

v1.0.4
Some pretty cool functionality already 
  1. a DM Mode (draw / erase walls + add / move any tokens and see stats) and a Player Mode (can add player tokens only and can see the names of things but not any stats nor add any walls)
  2. Currently can add any image for tokens or background of anything that has a web URL image or is a local image file
  3. Shows server for connectivity over WiFi if testing on the same machine but say different browser, http://localhost:4000 works as well
  4. Primarily is written in HTML with some CSS to wrap in some JavaScript, will work with touch devices but the server currently must be run on Windows (plans for Linux soon, but no Mac to create anything compatible there)
  5. You will need to open up firewall port 4000 but it will prompt for that if using the basic Windows Firewall for example and so long as a local Admin you can approve -- this is usually a one time pop up.
  6. Multiple size grids from small to extremely large... small is better for single battles, larger ones are better if you are planning on setting up a dungeon run beforehand (but currently no fog of war so best use case is the single battlegrounds



Current oddities
  1. Does not install directly to the Start Menu when using the Release .zip that has a Setup.exe inside but does show up properly on Control Panel Programs and Features as well as Add or remove programs. Additionally files will install in C:\Users\%USERNAME%\AppData\Local\ThorGrid and you can pin the ThorGrid.exe there to your Start / send shortcut to Desktop etc. - RESOLVED in 1.0.5
  2. if using the source files it was originally on the base C: drive with the folder thorgrid-electron if for some reason it gives any issues about pathing (so C:\thorgrid-electron).
