PF2 Helper
----------

This is an Roll20 API script designed to help running Pathfinder Second Edition. It has three main features:

* Parsing of NPCs/Monsters from Paizo PDFs and monster.pf2.tools json
* Hiding of enemy rolls, names, and more correct handling of criticals (including deadly and fatal)
* Making secret rolls easier

Installation
------------
As it's still in development, PF2 Helper is not available directly from Roll20. To use it, you need a Roll20 Plus account, add an API script to your game, and then copy-paste the contents of [pf2_helper.js](https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/pf2_helper.js) into the editor window of Roll20, and hit "Save Script"

<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/install.jpg" width="200" height="200" class="center">

In your game you should see a number of macros get created in the Collection tab, I recommend setting "parse" and "pf2-config" to be in your bar.

Enemy Parsing
=============
To try parsing an enemy, add a character in the journal tab, and in the GM notes field, copy and paste the statblock for an enemy in from your PDF. Here I have done the Flytrap Leshy:

<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_paste.jpg" width="219" height="300" class="center">

The parsing algorithm has been designed to handle poorly formatted input as much as possible, so don't worry if there are some extra lines with numbers on, or weird line breaks, hopefully it should be able to handle that. You might also add a token as an avatar at this stage, but there's no need to change the name. Click "Save Changes" and drag it onto the table, and with the token selected, hit the "Parse" button to invoke that macro.

It will pop up and ask you for the name your players will see. That's because when we're hiding rolls we will report just the result to the player, and rather than reveal the name of the creature, we can choose to give it a more descriptive name here. If you'd prefer to use it's real name, just delete the contents of this dialogue and pass an empty string.

With luck you'll see the message "Character Flytrap Leshy parsed successfully using PDF format" whispered to you in the chat, and the character should have been filled in as much as possible:

<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_parsed.jpg" width="270" height="228" class="center">
