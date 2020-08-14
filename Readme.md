PF2 Helper
==========

This is an Roll20 API script designed to help running Pathfinder Second Edition. It has four main features:

* Parsing of NPCs/Monsters from Paizo PDFs and monster.pf2.tools json
* Quick macros for rolling saves / skills and attacks of enemies.
* Hiding of enemy rolls, names, and more correct handling of criticals (including deadly and fatal)
* Making secret rolls easier

Installation
------------
As it's still in development, PF2 Helper is not available directly from Roll20. To use it, you need a Roll20 Plus account, add an API script to your game, and then copy-paste the contents of [pf2_helper.js](https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/pf2_helper.js) into the editor window of Roll20, and hit "Save Script"
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/install.jpg" width="200" height="200" class="center">
</p>

In your game you should see a number of macros get created in the Collection tab, I recommend setting "parse" and "pf2-config" to be in your bar.

Enemy Parsing
-------------
To try parsing an enemy, add a character in the journal tab, and in the GM notes field, copy and paste the statblock for an enemy in from your PDF. Here I have done the Flytrap Leshy:
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_paste.jpg" width="219" height="300" class="center">
</p>
The parsing algorithm has been designed to handle poorly formatted input as much as possible, so don't worry if there are some extra lines with numbers on, or weird line breaks, hopefully it should be able to handle that. You might also add a token as an avatar at this stage, but there's no need to change the name. Click "Save Changes" and drag it onto the table, and with the token selected, hit the "Parse" button to invoke that macro.

It will pop up and ask you for the name your players will see. That's because when we're hiding rolls we will report just the result to the player, and rather than reveal the name of the creature, we can choose to give it a more descriptive name here. If you'd prefer to use it's real name, just delete the contents of this dialogue and pass an empty string.

With luck you'll see the message "Character Flytrap Leshy parsed successfully using PDF format" whispered to you in the chat, and the character should have been filled in as much as possible:
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_parsed.jpg" width="330" height="240" class="center">
</p>
It will also have set the first token bar to the hit points, and the second to the focus points for the creature, if they have them. Note that because the compendium is not available from the API the spells are created but have no information filled in alas.

You can also use the json output from monster.pf2.tools in the same way.

Rolling Assistants
------------------
A number of macros should have been set up automatically as token actions. When you click on your new creature you should see them pop up by the select tool. Try clicking them! Note that by default rolls are whispered to the GM, parsed, then summarized to the players with the modifiers removed (and using the name we gave the enemy earlier). This is both to allow the GM to keep information like modifiers hidden, but also to facilitate rewriting of critical damage. For example, lets see what happens when we roll an attack for our leshy:
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_attack_normal.jpg" width="150" height="350" class="center">
</p>

The critical damage is exactly twice the regular damage, huzzah! We can also see that it handles deadly and fatal correctly, based on the contents of the traits field for the corresponding weapon. If I edit that field to add fatal and deadly we can see what happens:
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_attack_fatal.jpg" width="150" height="350" class="center"> <img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/leshy_attack_deadly.jpg" width="150" height="350" class="center">
</p>
You can turn off this roll hiding using the !pf2-config macro, but you'll need to reparse the creature for it to take effect

Secret Rolls
------------

There are two macros that are by default shared with all players to facilitate making secret checks. The first is the "secret" macro. It asks for a bonus, then makes a roll that only the GM can see. If the GM clicks it, then there is no indication given to the players, whereas if a player clicks it it announces that they are making a roll so that can see that it has had an effect.

The secret-skills macro is analogous but more powerful. It allows clicking on a token, or selecting a group of tokens, then choosing a skill (or perception) to roll for them all secretly, which are then presented to the GM in a table, along with the relevant proficiencies. For example:
<p align="center">
<img src="https://raw.githubusercontent.com/tompudding/roll20_pf2_helper/master/readme_images/secret_skills.jpg" width="300" height="300" class="center">
</p>
Again, if a player uses it, it announces in the chat that a roll has been made so the player gets some feedback.

Config
------
You can use the config macro to enable or disable some features, such as the roll hiding and the MAP popups that are written into the macros.

Sounds
------
If you have a sound called "critical_threat" it will play when an attack roll with a natural 20 is rolled in the chat. Similarly "fan_fumble" will play on a natural 1, and "roll_for_initiative" will play when the turn tracker appears.

Bugs and Feature Requests
----
Please send bug reports or feature requests to tom.pudding@gmail.com

Changelog
---------

## 1.04

* Fixed issue parsing strike damage entries that don't include dice, such as "Varies by bomb". Thanks to Dr. Thod for reporting.
* Added a changelog
