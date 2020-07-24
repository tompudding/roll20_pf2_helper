var module_name = 'PF2 Helper'

function get_index(msg) {
    var roll_match = RegExp("\\$\\[\\[(\\d+)\\]\\]");

    var index = roll_match.exec(msg);
    if( null == index ) {
        return null;
    }
    return parseInt(index[1], 10);
}

function get_index_extra(msg) {
    var roll_match = RegExp("\\$\\[\\[(\\d+)\\]\\](.*)");

    var index = roll_match.exec(msg);
    if( null == index ) {
        return null;
    }
    return index[2]
}

function is_threat(roll) {
    if( roll.mods.customCrit[0].comp != '>=' ) {
        return roll.results[0].v == 20;
    }
    return roll.results[0].v >= roll.mods.customCrit[0].point;
}

function set_attribute(id, attr_name, value) {
    var attrs = findObjs({type : 'attribute', characterid:id, name:attr_name});
    for (var ob of attrs) {
        ob.remove();
    }
    createObj("attribute", {name:attr_name, current:value, max:value, characterid: id});
}

function get_attribute(id, attr_name) {
    objs = findObjs({type : 'attribute', characterid:id, name:attr_name})
    if( objs.length == 0 ) {
        log('no attribute darn');
        return undefined;
    }
    return objs[0].get('current');
}

function parse_roll(to_hit, die_result, threat) {
    if(die_result == 1) {
        return '[[1d1cs>2]] Fumble'
    }
    else if(die_result == 20) {
        return '[[1d1cf<0cs>1*20]] Natural Twenty!'
    }
    else {
        return `[[1d1cf<0cs>2*${to_hit}]]`
    }
}

function clean_carrots(input) {
    if(input.startsWith('^{')) {
        return input + '}';
    }
    return input;
}

function title_case(text) {
    log('title case');
    log(text);
    return text.replace(
        /(\w)(\w*)/g,
        (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase()
    );
}

class Attack {
    constructor(to_hit, damage, damage_type, die_result, extra_crit_damage, fatal) {
        this.to_hit = to_hit;
        this.damage = damage;
        if(fatal) {
            this.crit_damage = `((${fatal})*2)`;
        }
        else {
            this.crit_damage = damage*2;
        }
        this.damage_type = damage_type;
        this.extra_crit_damage = extra_crit_damage;
        this.die_result = die_result;
        if( die_result == 20 ) {
            play('critical_thread');
        }
        else if( die_result == 1 ) {
            play('fan_fumble');
        }
        if(to_hit) {
            this.roll = parse_roll(to_hit, die_result);
        }
        else {
            this.roll = '';
        }
    }

    format() {
        var damage_type = "";
        if(this.damage_type) {
            damage_type = `{{roll02_info=${this.damage_type}}}`;
        }
        var to_hit = "";
        if(this.to_hit) {
            to_hit = `{{roll01=${this.roll}}} {{roll01_type=attack}} {{roll01_critical=1}}`;
        }

        var damage = "";
        if(this.damage) {
            damage = `{{roll02_name=^{damage}}} {{roll02=[[${this.damage}]]}} {{roll02_type=damage}} ${damage_type} {{roll03_name=^{critical_damage}}} {{roll03=[[${this.crit_damage} + ${this.extra_crit_damage}]]}} {{roll03_type=critical-damage}}`
        }
        return `{{roll01_name=^{attack}}} ${to_hit} ${damage}`
    }
}

class Roll {
    constructor(content, rolls) {
        var attacker_reg = RegExp(
            `{{charactername=(.*?)}}[^}].*`+
            `{{header=(.*?)}}[^}].*` +
            `{{subheader=(.*?)}}[^}]`, "g"
        );
        var attacker_match = attacker_reg.exec(content);
        if( attacker_match == null || attacker_match.length < 2) {
            log("No character name: " + attacker_match);
            return;
        }
        var attacker = findObjs({type : 'character', name:attacker_match[1]})[0];

        var attr = findObjs({type : 'attribute', characterid: attacker.id, name:'identified'})[0];

        this.name = getAttrByName(attacker.id, "unknown_name");

        if( undefined == this.name ) {
            this.name = 'Strange Creature'
        }

        if( attr ) {
            var identified = attr.get("current");
            if( identified == true ) {
                this.name = attacker.get("name");
            }
        }

        var self = this;
        self.character_name = attacker_match[1];
        self.header = attacker_match[2];
        self.subheader = attacker_match[3];
    }
}

function get_rolls(content, inlinerolls) {
    var rolls = {};

    for(var i = 1; i <= 4; i++) {
        var num = i;
        var regexps = [`{{roll0${num}_name=(.*?)}}[^}].*`,`{{roll0${num}=(.*?)}}[^}].*`,`{{roll0${num}_type=(.*?)}}([^}]|$).*`];
        var results = [];

        for(var re of regexps) {
            var matches = RegExp(re,"g").exec(content);
            if(!matches || matches.length < 2) {
                //These are all essential
                break;
            }

            results.push(matches[1]);
        }

        if( results.length < 3) {
            log(`nono on ${i} ${results.length}`)
            continue;
        }

        //We got all three essential data fields, perhaps there's also an info?
        var roll_name = results[0];
        var roll_type = results[2];
        var roll_info = RegExp(`{{roll0${num}_info=(.*?)}}`,"g").exec(content);
        if(roll_info && roll_info.length > 1) {
            roll_info = roll_info[1];
        }
        else {
            roll_info = undefined;
        }
        //At least for now; "damage_additional" doesn't store the type in the corresponding "info" field, it puts it after the roll index. Whatevs
        var roll = null;
        log('1');
        if(roll_name.match("additional")) {
            //There can be multiple rolls here, each with the type afterwards. We want to break them down,
            //total them up, and add the damage types to a string
            let last_match = null;
            let roll_re = RegExp("\\$\\[\\[(\\d+)\\]\\]","g");
            let total_additional = 0;
            let additional_types = [];
            while(1) {

                let match = roll_re.exec(results[1]);
                if( null == match ) {
                    //We're done, but there might be a final bit of info.
                    if( last_match != null && last_match < results[1].length ) {
                        additional_types.push( results[1].substring(last_match) );
                    }
                    break;
                }
                log('yo ' + last_match + ' mi= ' + match.index)
                if( last_match != null && match.index != last_match ) {
                    //There's in between stuff.
                    additional_types.push( results[1].substring(last_match, match.index) );
                }
                last_match = roll_re.lastIndex;
                let roll_index = parseInt(match[1], 10);
                let value = inlinerolls[roll_index].results.total;
                total_additional += value;
            }
            log(additional_types);
            roll_info = additional_types.join("");

            //do between and stuff

            //if( roll_info == undefined ) {
            //    roll_info = get_index_extra(results[1]);
            //}
            if( roll_type == 'damage') {
                roll_type = 'damage_additional';
            }
            roll = total_additional;
        }


        var roll_index = get_index(results[1]);
        if( null == roll_index ) {
            log("No roll index");
            break;
        }
        if( roll == null ) {
            roll = inlinerolls[roll_index];
        }

        rolls[roll_type] = {name:roll_name, roll:roll, type:roll_type, info:roll_info};
    }

    return rolls;
}

class AttackRoll extends Roll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        var self = this;
        var rolls = get_rolls(content, inlinerolls);

        //Add to a list
        if( rolls.length <= 1 ) {
            return;
        }
        var damage = rolls['damage'].roll.results.total;
        var to_hit = rolls['attack'].roll.results.total;
        var die_result = rolls['attack'].roll.results.rolls[0].results[0].v
        var damage_type = rolls['damage'].info
        if('damage_additional' in rolls) {
            damage += rolls['damage_additional'].roll;
            if(rolls['damage_additional'].info) {
                damage_type += ', ' + rolls['damage_additional'].info;
            }
        }

        //It's possible to have traits on the attack roll...
        var match = RegExp(`{{roll01_info=[^}]*deadly.(\\d?d\\d+)`,"ig").exec(content);
        var extra_crit = "0";
        if(match && match.length > 1) {
            //We need to add this to the crit damage.
            extra_crit = match[1];
        }
        match = RegExp(`{{roll01_info=[^}]*fatal.(d\\d+)`,"ig").exec(content);
        var fatal = null;
        if(match && match.length > 1) {
            //We need to add this to the crit damage.

            //for fatal we want to replace the first instance of [0-9]+d[0-9]+ with one more die and the type
            //set to the fatal type
            var old_dice = RegExp("(\\d+)d(\\d+)","g").exec(rolls['damage'].roll.expression);
            if( old_dice.length > 2 ) {
                var num_old = parseInt(old_dice[1]);
                var type_old = old_dice[2];

                var new_dice = `${num_old}${match[1]}`
                fatal = rolls['damage'].roll.expression.replace(old_dice[0],new_dice);
                if(extra_crit) {
                    extra_crit += '+' + `1${match[1]}`;
                }
                else {
                    extra_crit = `1${match[1]}`;
                }
            }
        }

        self.attack = new Attack(to_hit, damage, damage_type, die_result, extra_crit, fatal);
    }

    format() {
        if(undefined == this.attack) {
            return '';
        }
        var self = this;
        var description = `&{template:rolls} {{header=${this.name}: ${this.header}}} {{subheader=${this.subheader}}}` + self.attack.format();
        return description;
    }
}

class SpellRoll extends Roll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        var self = this;
        var rolls = get_rolls(content, inlinerolls);

        //Add to a list
        if( rolls.length <= 1 ) {
            return;
        }
        var damage = undefined;
        var damage_type = undefined;
        var to_hit = undefined;
        var die_result = undefined;

        if('damage' in rolls) {
            damage = rolls['damage'].roll.results.total;
            damage_type = rolls['damage'].info;
        }
        if('attack' in rolls) {
            to_hit = to_hit = rolls['attack'].roll.results.total;
            die_result = rolls['attack'].roll.results.rolls[0].results[0].v
        }

        self.attack = new Attack(to_hit, damage, damage_type, die_result, 0, false);
    }

    format() {
        if(undefined == this.attack) {
            return '';
        }
        var self = this;
        var description = `&{template:rolls} {{header=${this.name}: Spell}} ` + self.attack.format();
        return description;
    }
}


class BasicRoll extends Roll{
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        var self = this;
        var s = `{{roll01=([^}]*)}}.*` +
                `{{roll01_type=([^}]*)}}.*`
        var save_matcher = RegExp(s,"g");
        var array1 = save_matcher.exec(content);

        if(array1 == null || array1.length < 3) {
            return;
        }

        var save_index = get_index(array1[1]);
        if( null == save_index ) {
            log("No save index");
            return;
        }
        var save_roll = inlinerolls[save_index];
        self.die_result = save_roll.results.rolls[0].results[0].v;
        self.save_total = save_roll.results.total;
        self.result = parse_roll(self.save_total, self.die_result, false);
    }

    format() {
        var self = this;
        return `&{template:rolls} {{header=${this.name} ${this.header}}} {{subheader=${this.subheader}}}` +
               `{{roll01=${this.result}}} {{roll01_type=${this.type}} {{notes_show=0}}`
    }
}

class Save extends BasicRoll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'saving-throw'
    }
}

class AbilityCheck extends BasicRoll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'ability'
    }
}

class Skill extends BasicRoll{
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'skill'
    }
}

class GenericAttack extends Roll{
    constructor(content, rolls) {
        super(content, rolls);
        var self = this;
        var s = '{{name=\\^{(.*)}}}.*{{check=([^}]*)}}'
        var matcher = RegExp(s,"g");
        var array1 = matcher.exec(content);
        //can I put this in the class and not instantiate it every time?
        var name_lookup = {
            "ranged-attack" : "Ranged Attack",
            "melee-attack" : "Melee Attack",
            "combat-maneuver-bonus-abbrv" : "CMB",
            "melee2-attack" : "Melee Attack",
            "ranged2-attack" : "Ranged Attack",
            "combat-maneuver-bonus-abbrv2" : "CMB"
        };

        if(array1 == null || array1.length < 3) {
            return;
        }
        var index = get_index(array1[2]);
        if( null == index ) {
            log("No save index");
            return;
        }
        var roll = rolls[index];
        self.die_result = roll.results.rolls[0].results[0].v;
        self.attack_total = roll.results.total;
        self.attack_name = name_lookup[array1[1]];
        if(undefined == self.attack_name) {
            self.attack_name = array1[1];
        }
    }

    format() {
        var self = this;
        var result = parse_roll(self.attack_total, self.die_result, false);
        return `&{template:pf_ability} {{name=${self.attack_name}}} {{Result=${result}}}`
    }
}

const getRepeatingSectionCounts = function (charid, prefix) {
	let repeatingAttrs = {};
	let regExp = new RegExp(`^${prefix}_(-[-A-Za-z0-9]+?|\\d+)_(.*)`);
	let repOrder;
	let ids = {};
	let count = 0;
	// Get attributes
	findObjs({
		_type: 'attribute',
		_characterid: charid
	}).forEach(o => {
	    const attrName = o.get('name');
	    var matches = regExp.exec(attrName);
	    if( null == matches ) {
		return;
	    }
	    if(!(matches[1] in ids)) {
		ids[matches[1]] = {};
		count += 1;
	    }
		//ids[matches[1]][matches[2]] = o;
	});
	return count;//ids;
}

function generate_row_id() {
    var out = ['-'];
    for( var i = 0; i < 19; i++) {
        out.push("-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZZabcdefghijklmnopqrstuvwxyz"[randomInteger(64)]);
    }
    return out.join("");
}

const getRepeatingSectionAttrs = function (charid, prefix) {
    // Input
    //  charid: character id
    //  prefix: repeating section name, e.g. 'repeating_weapons'
    // Output

    //  repRowIds: array containing all repeating section IDs for the given prefix, ordered in the same way
    //  that the rows appear on the sheet

    //  repeatingAttrs: object containing all repeating attributes that exist for this section, indexed by
    //  their name

    const repeatingAttrs = {};
    const regExp = new RegExp(`^${prefix}_(-[-A-Za-z0-9]+?|\\d+)_(.*)`);
    //const type_regexp = new RegExp('^${prefix}_(-[-A-Za-z0-9]+?|\\d+)_(.*)`);
	let repOrder;
	// Get attributes
	findObjs({
		_type: 'attribute',
		_characterid: charid
	}).forEach(o => {
		const attrName = o.get('name');
		if (attrName.search(regExp) === 0) repeatingAttrs[attrName] = o;
		else if (attrName === `_reporder_${prefix}`) repOrder = o.get('current').split(',');
	});
	if (!repOrder) repOrder = [];
	// Get list of repeating row ids by prefix from repeatingAttrs
	const unorderedIds = [...new Set(Object.keys(repeatingAttrs)
		.map(n => n.match(regExp))
		.filter(x => !!x)
		.map(a => a[1]))];
    const repRowIds = [...new Set(repOrder.filter(x => unorderedIds.includes(x)).concat(unorderedIds))];
    const wtf_functional_madness = {}
    for(var o in repeatingAttrs) {
        var match = regExp.exec(o);

        if( !(match[1] in wtf_functional_madness) ) {
            wtf_functional_madness[match[1]] = {};
        }
        wtf_functional_madness[match[1]][match[2]] = repeatingAttrs[o]
    }

    return [repRowIds, wtf_functional_madness];
}

function roll_secret_skill(msg) {
    let matches=RegExp("{{id=([^}]*)}}.*{{skill=([^}]*)}}").exec(msg.content)
    if( matches.length != 3 ) {
        return;
    }
    let id = matches[1];
    let skill = matches[2];
    if( skill != "Lore") {
        //This one is fairly easy, we just grab their current skill bonus in this skill and roll it
        skill = skill.toUpperCase();
        let bonus = getAttrByName(id, skill);
        let who = msg.who;

        while(bonus.startswith != undefined && bonus.startsWith('+')) {
            bonus = bonus.slice(1);
        }
        bonus = parseInt(bonus);
        if( isNaN(bonus) ) {
            sendChat('GM', `/w GM Invalid input ${bonus_str}`);
            return;
        }
        sendChat('GM', `/w GM Secret roll for ${who} in ${skill} with bonus ${bonus} = [[1d20+${bonus}]]`);
    }
    else {
        //We want to send a button to the player to press that will be populated with lores to roll secretly
        return show_secret_lore_buttons(id, msg);
    }
}

function roll_secret(msg) {
    var bonus_str = RegExp("{{bonus=([^}]*)}}").exec(msg.content)[1];
    while(bonus_str.startsWith('+')) {
        bonus_str = bonus_str.slice(1);
    }
    var bonus = parseInt(bonus_str);
    if( isNaN(bonus) ) {
        sendChat('GM', `/w GM Invalid input ${bonus_str}`);
        return;
    }
    var who = msg.who;
    sendChat('GM', `/w GM Secret roll for ${who} with bonus ${bonus_str} = [[1d20+${bonus}]]`);
}

function parse_expressions(damage_string) {
    // We want 2d6+10 plus 1d6 fire and 2d6 evil to return
    //
    // {normal : 2d6+10,
    //  extra  : [[1d6]] fire and [[2d6]] evil}
    //
    let expressions = []
    let dice_positions = []
    let pos = 0;
    let num_trials = 0;
    while(pos < damage_string.length) {
        let re = RegExp('(\\d+d\\d+)','ig');
        let match = re.exec(damage_string);
        let expr = []
        let last = 0;

        while(1) {
            //we always take the dice expression

            if(match == null || last != match.index) {
                //we've got some inbetween to look at. If this has got anything other than +-numbers with possible whitespace then we're done
                var end = undefined
                if( match ) {
             	    end = match.index
                }
                let between = damage_string.substring(last, end);
                let between_re = RegExp('(^[+-\\d\\s]+)','g')
                let between_match = between_re.exec(between)
                if( null == between_match ) {
                    expressions.push(between);
                    last = end;
                    break;
                }
                //If only some part of it matched we're still done, but we need that part
                expr.push(between_match[0]);
                last += between_re.lastIndex;
                if( between_re.lastIndex != between.length ) {

                    break;
                }
                if( match == null) {
             	    break;
                }
            }
            expr.push(match[1]);
            //expr.push(match[1]);
            last = re.lastIndex;
            match = re.exec(damage_string);
        }
        expr = expr.join('');
        let rest = damage_string.substring(last);
        pos = 0;
        if(expr.length > 0) {
            dice_positions.push(expressions.length);
            expressions.push(expr);
        }
        damage_string = rest;
        num_trials += 1;
        if( last == 0 || last == null) {
            break;
        }
    }

    return {parts : expressions,
            dice  : dice_positions,
           }
}

function parse_damage(damage_string) {
    data = parse_expressions(damage_string);
    //Damage is easy, it's the first dice expression
    let damage = data.parts[data.dice[0]];
    let type = 'unknown';
    let rest_start = data.dice[0] + 1;
    //If there's a non dice expression between the first and second it's probably the type,
    if( data.dice[1] != data.dice[0] + 1 && data.parts.length > data.dice[0] + 1) {
        type = data.parts[data.dice[0] + 1];
        rest_start += 1;
    }

    //For the rest we surround all the dice expressions with square brackets and put it all together
    for(var i = 1; i < data.dice.length; i++) {
        data.parts[data.dice[i]] = '[[' + data.parts[data.dice[i]] + ']]';
    }
    let additional = data.parts.slice(rest_start);
    additional = additional.join(" ");

    //As a final check, we might have left the word 'plus' or 'with' or something attached to our damage
    //type. We go through that and allow 'and' and commas to be in it, but anything else is the end of the
    //type and we shift that to the additional field
    type_parts = type.split(' ');
    let type_end = 0;
    for(var i = 0; i < type_parts.length; i++) {
        let part_lower = type_parts[i].toLowerCase()
    	if( part_lower == 'plus') {
      	    //we're always done;
            break;
        }
        if( i > 0 && part_lower != 'and' && part_lower != ',') {
            break;
        }
        type_end = i+1;
    }
    if( type_end != type_parts.length -1 ) {

        type = type_parts.slice(0, type_end).join(' ');
        additional = type_parts.slice(type_end).join(' ') + additional;
    }

    return {damage : damage,
    	    type : type,
            additional : additional};
}

function turn_off_marker_character(id, marker_name) {
    var statuses = findObjs({represents:id});
    for (var token of statuses) {
        var status = token.get("statusmarkers");
        if( status.indexOf(marker_name) == -1 ) {
            continue;
        }
        var on = status.split(',');
        var new_on = []
        for(var item of on) {
            if( item.indexOf(marker_name) == -1 ) {
                new_on.push(item);
            }
        }
        on = new_on.join(',');
        token.set("statusmarkers", on);
    }
}

function turn_off_marker_token(id, marker_name) {
    var token = getObj('graphic',id);
    var represents = token.get('represents');
    if(represents) {
        return turn_off_marker_character(represents, marker_name);
    }
    else {
        var status = token.get("statusmarkers");
        if( status.indexOf(marker_name) == -1 ) {
            return;
        }
        var on = status.split(',');
        var new_on = []
        for(var item of on) {
            if( item.indexOf(marker_name) == -1 ) {
                new_on.push(item);
            }
        }
        on = new_on.join(',');
        token.set("statusmarkers", on);
    }
}

function link_token_bars(character) {
    var tokens = findObjs({type:'graphic', represents:character.id});

    var hp    = findObjs({type : 'attribute', characterid:character.id, name:'hit_points'})[0];
    var focus = findObjs({type : 'attribute', characterid:character.id, name:'focus_points'});
    if( focus ) {
        focus = focus[0];
    }

    for(var token of tokens) {
        token.set('bar1_value', hp.get('current'));
        token.set('bar1_max', hp.get('max'));

        if( focus && focus.get('max') > 0 ) {
            token.set('bar2_value', focus.get('current'));
            token.set('bar2_max', focus.get('max'));
        }
    }
}

function play(title) {
    var track = findObjs({type:'jukeboxtrack', title:title})[0];
    if( track ) {
        track.set({playing:true, softstop:false, loop:false});
    }
}

function parse_json_character(character, data) {
    let set_string = {'traits'    : 'traits',
                      'alignment' : 'alignment',
                      'size'      : 'size',
                      'type'      : 'npc_type',
                      'languages' : 'languages',
                      'alignment' : 'alignment',
                     };

    let set_int = {'level'       : 'level',
                   'speed'       : 'speed',
                   'focuspoints' : 'focus_points',
                  };

    let set_value = {'ac'           : 'armor_class',
                     'hp'           : 'hit_points',
                     'fortitude'    : 'saving_throws_fortitude',
                     'reflex'       : 'saving_throws_reflex',
                     'will'         : 'saving_throws_will',
                     'resistance'   : 'resistances',
                     'immunity'     : 'immunities',
                     'weakness'     : 'weaknesses',
                     'strength'     : 'strength_modifier',
                     'dexterity'    : 'dexterity_modifier',
                     'constitution' : 'constitution_modifier',
                     'intelligence' : 'intelligence_modifier',
                     'wisdom'       : 'wisdom_modifier',
                     'charisma'     : 'charisma_modifier',
                     'acrobatics'   : 'acrobatics',
                     'arcana'       : 'arcana',
                     'athletics'    : 'athletics',
                     'crafting'     : 'crafting',
                     'deception'    : 'deception',
                     'diplomacy'    : 'diplomacy',
                     'intimidation' : 'intimidation',
                     'medicine'     : 'medicine',
                     'nature'       : 'nature',
                     'occultism'    : 'occultism',
                     'performance'  : 'performance',
                     'religion'     : 'religion',
                     'society'      : 'society',
                     'stealth'      : 'stealth',
                     'survival'     : 'survival',
                     'thievery'     : 'thievery',
                     'spellattack'  : 'spell_attack',
                     'spelldc'      : 'spell_dc',
                    };

    let set_notes = {'acrobatics'   : 'acrobatics_notes',
                     'arcana'       : 'arcana_notes',
                     'athletics'    : 'athletics_notes',
                     'crafting'     : 'crafting_notes',
                     'deception'    : 'deception_notes',
                     'diplomacy'    : 'diplomacy_notes',
                     'intimidation' : 'intimidation_notes',
                     'medicine'     : 'medicine_notes',
                     'nature'       : 'nature_notes',
                     'occultism'    : 'occultism_notes',
                     'performance'  : 'performance_notes',
                     'religion'     : 'religion_notes',
                     'society'      : 'society_notes',
                     'stealth'      : 'stealth_notes',
                     'survival'     : 'survival_notes',
                     'thievery'     : 'thievery_notes'}

    var spells      = false;
    var cantrips    = false;
    var focusspells = false;
    var innate      = false;

    for( var key of Object.keys(set_value) ) {
        set_attribute(character.id, set_value[key], '');
    }
    for( var key of Object.keys(set_int) ) {
        set_attribute(character.id, set_int[key], '');
    }

    //Let's delete all the strikes
    delete_repeating(character.id, 'repeating_melee-strikes');
    delete_repeating(character.id, 'repeating_ranged-strikes');
    delete_repeating(character.id, 'repeating_free-actions-reactions');
    delete_repeating(character.id, 'repeating_actions-activities');
    delete_repeating(character.id, 'repeating_normalspells');
    delete_repeating(character.id, 'repeating_spellinnate');
    delete_repeating(character.id, 'repeating_spellfocus');
    delete_repeating(character.id, 'repeating_cantrip');
    delete_repeating(character.id, 'repeating_lore');
    disable_spellcaster(character.id);

    for( var key of Object.keys(data) ) {

        if( key == 'name' ) {
            //This one isn't an attribute, it's special
            character.set('name', title_case(data[key]));
        }
        else if( key == 'perception' ) {
            //This one is a bit odd as it has a notes field that sets senses
            set_attribute(character.id, 'perception', data[key]['value']);
            if( data[key]['note'] ) {
                set_attribute(character.id, 'senses', data[key]['note']);
            }
        }
        else if( key in set_string ) {
            set_attribute(character.id, set_string[key], title_case(data[key]));
        }
        else if( key in set_int ) {
            set_attribute(character.id, set_int[key], data[key]);
        }
        else if( key in set_value && data[key]['value'] ) {
            set_attribute(character.id, set_value[key], data[key]['value']);
        }

        if( key in set_notes && data[key]['note'] ) {
            set_attribute(character.id, set_notes[key], data[key]['note']);
        }

        else if( key == 'strikes' ) {
            for( var strike of data[key] ) {
                let id = generate_row_id();
                let stub = '';
                if( strike['type'] == 'Melee' ) {
                    stub = `repeating_melee-strikes_${id}_`;
                }
                else if( strike['type'] == 'Ranged' ) {
                    stub = `repeating_ranged-strikes_${id}_`;
                }
                else {
                    continue;
                }
                let damage = parse_damage(strike['damage']);
                if( null == damage ) {
                    continue;
                }
                set_attribute(character.id, stub + 'weapon', strike['name']);
                set_attribute(character.id, stub + 'weapon_strike', strike['attack']);
                set_attribute(character.id, stub + 'weapon_traits', strike['traits']);
                set_attribute(character.id, stub + 'weapon_strike_damage', damage.damage);
                set_attribute(character.id, stub + 'weapon_strike_damage_type', damage.type);
                set_attribute(character.id, stub + 'weapon_strike_damage_additional', damage.additional);
                set_attribute(character.id, stub + 'toggles', 'display,');
            }
        }

        else if( key == 'specials' ) {
            for(var special of data[key]) {
                let id = generate_row_id();
                let stub = '';
                let action = special['actions'];
                if( action == 'none' || action == 'reaction' || action == 'free' ) {
                    //This should go in the automatic or reactive abilities sections
                    stub = `repeating_free-actions-reactions_${id}_`
                    let free_action = 0;
                    let reaction = 0;
                    if( action == 'reaction' ) {
                        reaction = 'reaction';
                    }
                    else if( action == 'free' ) {
                        free_action = 'free action';
                    }
                    set_attribute(character.id, stub + 'free_action', free_action);
                    set_attribute(character.id, stub + 'reaction', reaction);
                }
                else if(action == 'one' ||
                        action == 'two' ||
                        action == 'three' ||
                        action == '1 minute' ||
                        action == '10 minutes') {
                    stub = `repeating_actions-activities_${id}_`
                    set_attribute(character.id, stub + 'actions', action);
                }
                else {
                    continue;
                }

                let description = special['description'];
                if( special['name'].toLowerCase() == 'attack of opportunity' && description == '' ) {
                    description = 'You lash out at a foe that leaves an opening. Make a melee Strike against the triggering creature. If your attack is a critical hit and the trigger was a manipulate action, you disrupt that action. This Strike doesn’t count toward your multiple attack penalty, and your multiple attack penalty doesn’t apply to this Strike. ';
                }
                description.replace('&nbsp;','\n')
                set_attribute(character.id, stub + 'name', special['name']);

                set_attribute(character.id, stub + 'rep_traits', special['traits']);
                set_attribute(character.id, stub + 'description', description);
                set_attribute(character.id, stub + 'toggles', 'display,');
            }
        }
        else if( key == 'spells' || key == 'morespells' ) {
            //We've got some spells. Firsty we need to turn on the spellcaster options.
            if( key == 'spells' ) {
                var spell_data = [data];
                var spell_type = data['spelltype'];
            }
            else {
                var spell_data = data['morespells'];
                var spell_type = spell_data['name'];
                // The input can have a different DC and attack roll here, but the roll20 sheet doesn't
                // support it so we ignore it
            }
            if( spell_type ) {
                spell_type = spell_type.toLowerCase();
            }
            for( var spell_datum of spell_data ) {
                var this_focus = spell_datum['focuspoints'] != undefined && spell_datum['focuspoints'] != '';

                var stub = `repeating_normalspells_`;
                if( this_focus ) {
                    // If they cost focus points we put them in the focus spells section
                    stub = 'repeating_spellfocus_';
                }
                else if (spell_type == 'innate') {
                    stub = 'repeating_spellinnate_';
                }

                for(var i = 0; i < 11; i++) {
                    if( spell_datum['spells'][i] ) {
                        spells = true;

                        //We're throwing some spells in!
                        let level = 10 - i;
                        let this_stub = stub;
                        if( level == 0 ) {
                            //cantrips
                            this_stub = `repeating_cantrip_`;
                            level = spell_datum['cantriplevel']
                            cantrips = true;
                        }
                        if( spell_type == 'innate' ) {
                            innate = true;
                        }
                        else if( this_focus ) {
                            focusspells = true;
                        }

                        var spell_names = spell_datum['spells'][i].split(', ');
                        for( var spell_name of spell_names ) {
                            if( spell_name.trim() == '' ) {
                                continue;
                            }
                            let id = generate_row_id();
                            set_attribute(character.id, this_stub + `${id}_` + 'name', spell_name);
                            set_attribute(character.id, this_stub + `${id}_` + 'current_level', level);
                            set_attribute(character.id, this_stub + `${id}_` + 'toggles', 'display,');
                        }
                    }
                }
            }
        }
        else if( key.startsWith('lore') ) {
            // monster.pf2.tools uses "lore" and "lorealt", and we extend that with "lore2", "lore3",...
            if( key != 'lore' && key != 'lorealt' ) {
                //Check for one of our extra lores
                let n = parseInt(lore.slice(4));
                if( isNaN(n) ) {
                    continue;
                }
            }
            //Otherwise it's good and we need a new lore
            let id = generate_row_id();
            let stub = 'repeating_lore_';
            set_attribute(character.id, stub + `${id}_` + 'lore_name', data[key]['name']);
            set_attribute(character.id, stub + `${id}_` + 'lore', data[key]['value']);
            if( data[key]['note'] ) {
                set_attribute(character.id, stub + `${id}_` + 'lore_notes', data[key]['note']);
            }
        }
    }

    //Turn on spellcaster stuff if there was any
    log('spells= ' + spells);
    log('cantrips= ' + cantrips);
    log('focusspells= ' + focusspells);
    log('innate= ' + innate);

    if( spells || cantrips || cantrips || innate) {
        enable_spellcaster(character.id, spells, cantrips, focusspells, innate);
        set_attribute(character.id, 'sort_normalspells', 'level');
    }
}

// The GM notes fields seems to sometimes have some html fields at the start. Let's clean it up by removing
// everything before the first opening and closing braces
function clean_json(input) {
    var json = RegExp('[^{]*({.*})[^}]*').exec(input);

    if( json ) {
        return json[1];
    }

    return null;
}

function is_upper_case(str) {
    return str == str.toUpperCase() && str != str.toLowerCase();
}

function is_lower_case(str) {
    return str == str.toLowerCase() && str != str.toUpperCase();
}

function is_title_case(words) {
    for( var word of words ) {
        if( false == is_upper_case(word[0]) || (word.length > 1 && false == is_lower_case(word.slice(1))) ) {
            return false;
        }
    }
    return true;
}


function load_pdf_data(input) {
    input = input.replace(/&nbsp;/g,' ')
    input = input.replace(/(<p[^>]+?>|<p>|<div>|<\/div>)/ig, "");
    //Paizo sometimes uses weird symbols for minus
    input = input.replace(/–/g,'-');
    lines = input.split(/<\/p>|<br>/ig);

    //The name should be the first line
    let bracket_index = /\s*\(\s*\d+\s*\)/g.exec(lines[0]);
    let name = lines[0].trim();
    if( bracket_index ) {
        name = lines[0].substring(0, bracket_index.index);
    }
    //try removing non-printable with magic from stack overflow
    name = name.replace(/[^ -~]+/g, "");
    output = {name : name};
    var matched = {};
    var valid_skills = ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
                        'lore', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
                        'survival', 'thievery'];


    matchers = [
        { re   : RegExp('^.*CREATURE\\s+(\\d+)\\s*(.*)','ig'),
          func : (match) => {
              log('creature feature');
              output.level = parseInt(match[1]);
              output.traits = match[2].split(/[ ,]+/).join(", ");
          },
          name : 'level',
        },
        //Perception is usually followed by a semicolon, but the sinspawn has a comma
        { re   : RegExp('^.*Perception\\s+\\+?(\\d+)[;,]?\\s*(.*)','ig'),
          func : (match) => {
              senses = '';
              if( match[2] ) {
                  senses = match[2].trim();
              }
              output.perception = {value : parseInt(match[1]),
                                   note  : senses
                                  }
          },
          name : 'perception',
        },
        { re : RegExp('^Languages\\s+(.*)'),
          func : (match) => {
              log('Got languages');
              output.languages = match[1].trim();
          },
          name : 'languages',
        },
        { re : RegExp('^Skills\\s+(.*)'),
          func : (match) => {
              log('skills')
              log(match);
              for( var skill_text of match[1].split(',') ) {
                  log(skill_text);
                  var data = /([a-zA-Z\s]+)\s+([+-]?\d+)\s*(\(.*\))?/.exec(skill_text);
                  if( null == data ) {
                      continue;
                  }
                  let skill_name = data[1];
                  let skill_value = data[2];
                  if( !skill_name || !skill_value ) {
                      continue;
                  }
                  skill_name = skill_name.toLowerCase().trim();
                  if( valid_skills.indexOf(skill_name) == -1 ) {
                      //This could be a lore skill
                      log('Unknown skill: ' + skill_name);
                      continue;
                  }
                  output[skill_name] = {value : skill_value};
                  if( data[3] ) {
                      //There's a note! Take off the brackets and save it
                      output[skill_name].note = data[3].slice(1,-1);
                  }
                  //TODO: We could also work out the benchmark here if we felt so inclined
              }
          },
          name : 'skills',
        },
        // It would be nice to parse all the attributes now, but sometimes they wrap multiple lines so we'd
        // best just do the first one
        { re : RegExp('^Str ([+-]\\d+).*'),
          func : (match) => {
              // The tiefling adept has a space between its + and its number. Weird. We can allow for that though
              var data = /^Str ([+-]?\s?\d+).*Dex ([+-]?\s?\d+).*Con ([+-]?\s?\d+).*Int ([+-]?\s?\d+).*Wis ([+-]?\s?\d+).*Cha ([+-]?\s?\d+).*/.exec(match[0]);
              log(match);
              log(data);
              if( null == data ) {
                  return;
              }
              output.strength     = {value : data[1].replace(/ /g,'')};
              output.dexterity    = {value : data[2].replace(/ /g,'')};
              output.constitution = {value : data[3].replace(/ /g,'')};
              output.intelligence = {value : data[4].replace(/ /g,'')};
              output.wisdom       = {value : data[5].replace(/ /g,'')};
              output.charisma     = {value : data[6].replace(/ /g,'')};
          },
          name : 'attributes',
        },
        { re : RegExp('^Items\\s*(.*)'),
          func : (match) => {log('items')},
          name : 'items',
        },
        //For the saves line we're expecting something of the form AC [number]; Fort +/-[number] (possible
        //note for the save), Ref +/[number] (possible note for the save)
        { re : RegExp('^AC\\s*(\\d+);\\s*Fort\\s*[+-]?(\\d+)\\s*(\\((.*?)\\))?,\\s*Ref\\s*[+-]?(\\d+)\\s*(\\((.*?)\\))?,\\s*Will\\s*[+-]?(\\d+)\\s*(\\((.*?)\\))?;?\\s*\\s*(.*)',"i"),
          func : (match) => {log('Saves');},
          name : 'saves',
        },
        // The HP line can have weaknesses, resistances and immunities, but I suspect some monsters will get printed at some point with those things in a different order, so we'll put it out in more than one regexp
        { re : RegExp('^HP\\s*(\\d+).*','i'),
          func : (match) => {log('HP and defences');},
          name : 'hp',
        },
        // The speeds also needn't be in order
        { re : RegExp('^Speed\\s*((\\d+) feet)?.*','i'),
          func : (match) => {log('speeds');},
          name : 'speeds',
        },
    ];
    multi_matchers = [
        //Next we're into looking at abilities. We can find simple attacks as they start with "Melee" or "Ranged"
        { re : RegExp('^Melee\\s*.*','i'),
          func : (match) => {log('melee');},
          name : 'melee',
        },
        // After creature we can get traits which are all caps
        { re   : RegExp('^\\s*([A-Z]+\\s*)+$',''),
          func : (match) => {
              let trait = match[0].trim();
              if( !trait ) {
                  return;
              }
              //If this is an alignment trait lets set that too
              if( trait == 'N' || (trait.length == 2 && 'LNC'.indexOf(trait[0]) != -1 && 'GNE'.indexOf(trait[1]) != -1 )) {
                  output.alignment = trait;
              }
              if( !output.traits ) {
                  output.traits = [match[0].trim()];
              }
              else {
                  output.traits.push(match[0].trim());
              }
              log('done trait');
          },
          name : 'trait',
        },
        { re : RegExp('^Ranged\\s*.*','i'),
          func : (match) => {log('ranged');},
          name : 'ranged',
        },
        //Via some PDF magic it seems that we get action symbols translated into cool "[one-action]" type text which we can use. It doesn't help us if it's a passive ability, but it helps with a lot of things
        { re : RegExp('^.*(\\[one-action\\]|\\[two-actions\\]|\\[three-actions\\]|\\[reaction\\]|\\[free-action\\]).*'),
          func : (match) => {log('action');},
          name : 'action',
        },

        //Poisons and diseases don't have the action symbol (as they're usually delivered by some other mechanism), but they should have a list of traits, one of which will be poison or disease.
        { re : RegExp('^.*(\\([^\\)]*(poison|disease).*\\)).*'),
          func : (match) => {log('affliction');},
          name : 'affliction',
        },
    ]
    matches = {};

    let final_lines = [];
    let current_lines = [];

    // The first pass will be to fold lines together so we have one line for each thing. The only difficult
    // part to that is special abilities that don't have an action because we can't match on an initial
    // keyword and we lose the bold in the next form. We'll try using if the first n words are capitalized and

    for(var line of lines.slice(1)) {
        // Sometimes when copying from a pdf we get a number on a line on its own, I'm not sure why.
        if( /^\s*\d+\s*$/.exec(line) ) {
            continue;
        }
        line = line.trim();
        if( !line ) {
            continue;
        }
        let match = null;
        // Next we check to see if it matches any of our special matchers
        for( var i = 0; i < matchers.length; i++) {
            match = matchers[i].re.exec(line);
            if( match ) {
                break;
            }
        }
        if( null == match ) {
            for( var i = 0; i < multi_matchers.length; i++) {
                match = multi_matchers[i].re.exec(line);
                if( match ) {
                    break;
                }
            }
        }

        if( null == match ) {
            // It didn't match anything, but there's still a chance it might be starting a block. I think the
            // only way to tell here is to look at if the first two words are in title case. TODO: that
            let words = line.split(' ');
            var possible_ability = words.length > 2;
            if( possible_ability ) {
                if( words[0] == 'Critical' && (words[1] =='Success' || words[1] == 'Failure') ) {
                    possible_ability = false;
                }
            }

            if( possible_ability && (words[0] == 'Success' || words[0] == 'Failure' )) {
                // This is less clear because an ability could be called "Success Magnet" or something, but
                // for now let's assume these are part of a block. We could check that adjacent lines had
                // critical in them
                possible_ability = false;
            }

            if( possible_ability && false == is_title_case(words.slice(0, 2)) ) {
                possible_ability = false;
            }
            if( false == possible_ability ) {
                current_lines.push(line);
                continue;
            }
        }

        //If we get here we have a match so this is starting a block. All preceding lines should be merged onto one
        if( current_lines.length > 0 ) {
            final_lines.push( current_lines.join(" ") );
        }
        current_lines = [line];
    }
    if( current_lines.length > 0 ) {
        final_lines.push( current_lines.join(" ") );
    }

    for(var line of final_lines) {
        // We take each line on its own, and decide what to do with it based on its content, and which things
        // we've already seen. If we haven't seen perception yet, then we've probably got a trait. For
        // example. Here are the heuristics we use:
        //
        // - The first line is a name, then creature level
        // - All the lines between the creature level and the perception are traits
        // - Languages and skills can be
        line = line.trim();
        let remove = null;
        for( var i = 0; i < matchers.length; i++) {
            match = matchers[i].re.exec(line);
            if( match ) {
                log('match on ' + matchers[i].name);
                log(matchers[i].func(match));
                remove = i;
                matched[matchers[i].name] = true;
                break;
            }
        }
        if( remove != null ) {
            matchers.splice(remove, 1);
        }
        for( var i = 0; i < multi_matchers.length; i++) {
            match = multi_matchers[i].re.exec(line);
            if( match ) {
                log('match on ' + multi_matchers[i].name);
                log(multi_matchers[i].func(match));
                matched[multi_matchers[i].name] = true;
            }
        }
        //if( matchers.length == 0 ) {
        //    log('all removed');
        //    break;
        //}
    }
    output.traits = output.traits.join(", ");
    log(output);
    return output;
}

function get_and_parse_character(msg) {
    log(msg.selected);
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];

    var character = getObj("character", id);
    log('character =' + character);
    //var gm_notes = getAttrByName(id, 'gmnotes');
    //GM notes are asynchronous
    //set_attribute(id, 'name', 'jimbo');
    log(character);
    character.get(
        'gmnotes',
        (notes) => {
            try {
                let json = clean_json(notes);
                let name = 'unknown';
                let format = 'none';
                if( json ) {
                    parse_json_character(character, JSON.parse(json));
                    format = 'JSON'
                }
                else {
                    log('monkey1');
                    data = load_pdf_data(notes);
                    if( data ) {
                        parse_json_character(character, data);
                        format = 'PDF';
                    }
                    else {
                        //That was our last hope
                        throw "Failed to parse in PDF or JSON format";
                    }
                }
                name = character.get('name');
                sendChat(module_name, `/w gm Character ${name} parsed successfully using ${format} format`)
            }
            catch(err) {
                log('got error ' + err);
                sendChat(module_name, '/w gm Error while parsing character' + String(err));
            }

            //Whatever the result, we always try to set the hit point and focus bars for the selected token
            try {
                link_token_bars(character);
            }
            catch(err) {
                log('got error while linking tokens ' + err);
                sendChat(module_name, '/w gm Error while linking token' + String(err));
            }
        }
    );
}

function handle_api(msg) {
    //log(msg.content);
    //log(msg.inlinerolls);
    //log(msg.selected);
    let command = msg.content.match('!([^\\s]+)\\s');
    if( null == command || command.length < 2 ) {
        return;
    }
    let handlers = {'attacks'        : show_attack_buttons,
                    'skills'         : show_skills_buttons,
                    'ability-checks' : show_ability_check_buttons,
                    'saves'          : show_save_buttons,
                    'abilities'      : show_ability_buttons,
                    'reactions'      : show_reaction_buttons,
                    'spells'         : show_spell_buttons,
                    'secret-skill'   : roll_secret_skill,
                    'secret'         : roll_secret,
                    'parse'          : get_and_parse_character,
                   };

    command = command[1];
    log('command' + command);

    if( command in handlers ) {
        return handlers[command](msg);
    }
}

function handle_whisper(msg) {
    if(undefined == msg.inlinerolls || msg.target != 'gm' || (!playerIsGM(msg.playerid) && msg.playerid != 'API')) {
        return;
    }
    //log('whisper');
    log(msg.content);
    log(msg.inlinerolls);
    log('***')
    //log(msg.playerid);
    //log(msg.target);
    //log(msg.rolltemplate);

    if(msg.content.match('name=\\^{traits}}}')) {
        roll = new SpellRoll(msg.content, msg.inlinerolls);
    }
    else if(msg.content.match('{{roll01_type=attack')) {
        roll = new AttackRoll(msg.content, msg.inlinerolls);
    }
    else if(msg.content.match('{{roll01_type=saving')) {
        roll = new Save(msg.content, msg.inlinerolls);
    }
    else if(msg.content.match('{{roll01_type=ability')) {
        roll = new AbilityCheck(msg.content, msg.inlinerolls);
    }
    else if(msg.content.match('{{roll01_type=skill')) {
        roll = new Skill(msg.content, msg.inlinerolls);
    }
    else {
        return;
    }

    sendChat('GM', roll.format());
}

function handle_general(msg) {
    //We only want to do this for player rolls
    if(undefined == msg.inlinerolls || msg.playerid == 'API') {
        return;
    }
    if(msg.content.match('{{roll01_type=attack')) {
        roll = new AttackRoll(msg.content, msg.inlinerolls);
    }
}

on("chat:message", function(msg) {
  //This allows players to enter !sr <number> to roll a number of d6 dice with a target of 4.
    try {
        if(msg.type == "whisper") {
            return handle_whisper(msg);
        }
        else if(msg.type == "api") {
            return handle_api(msg);
        }
        else if(msg.type == 'general') {
            return handle_general(msg);
        }
    }
    catch(err) {
        log('caught error: ' + err);
    }

});

function delete_repeating(id, stub) {
    const [IDs, attributes] = getRepeatingSectionAttrs(id,stub);
    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        for(var name in attrs) {
            attrs[name].remove();
        }
    }
}
var toggle_buttons = {'innate' : ['toggle_innate','innate'],
                      'focus'  : ['toggle_focus','focus'],
                      'cantrips' : ['toggle_cantrips', 'cantrips'],
                      'normalspells' : ['toggle_normalspells', 'spells']};
function disable_spellcaster(id) {
    var toggles = get_attribute(id, 'toggles');
    if( toggles == undefined || toggles == null ) {
        set_attribute(id, 'toggles', '');
        return;
    }
    log(`Initial toggles "${toggles}"`);

    toggles = toggles.split(',')
    var new_toggles = []
    let ignore = ['npcspellcaster','innate','focus','cantrips','normalspells']

    for( var toggle of Object.keys(toggle_buttons) ) {
        set_attribute(id, toggle_buttons[toggle][0], 0);
    }

    for(var toggle of toggles) {
        log(toggle,ignore);
        if( ignore.includes(toggle) ) {
            continue;
        }
        new_toggles.push(toggle);
    }
    let toggle_string = new_toggles.join(',');

    log(`Setting toggles to "${toggle_string}"`);
    set_attribute(id, 'toggles', toggle_string);
}

function enable_spellcaster(id, spells, cantrips, focusspells, innate) {
    var toggles = get_attribute(id, 'toggles');
    if( toggles == undefined ) {
        toggles = '';
    }

    log(`initial toggles "${toggles}"`);

    let bools = [innate, focusspells, cantrips, spells];
    let toggle_names = ['innate','focus','cantrips','normalspells']
    let new_toggles = ['npcspellcaster'];

    for( var i = 0; i < bools.length; i++) {
        if( bools[i] ) {
            new_toggles.push(toggle_names[i]);
            set_attribute(id, toggle_buttons[toggle_names[i]][0], toggle_buttons[toggle_names[i]][1]);
        }
    }

    let toggle_string = new_toggles.join(',');

    if( toggles != '' ) {
        toggle_string = toggles + ',' + toggle_string;
    }
    log(`setting toggles to "${toggle_string}"`);
    set_attribute(id, 'toggles', toggle_string);
}

function add_forceful(damage) {
    let new_damage = damage.get('current');
    if( typeof(new_damage) == 'number' ) {
        new_damage = new_damage.toString();
    }

    if( new_damage.indexOf('?{Attack') != -1 ) {
        return null;
    }

    if(false == new_damage.endsWith('+')) {
        new_damage += '+';
    }

    //The damage dice is hopefully the first dice expression in there
    let damage_dice = RegExp('(\\d+)d\\d+','ig').exec(new_damage);
    if( null == damage_dice ) {
        //There's nothing to add if the attack for some reason doesn't have any damage dice
        return null;
    }
    damage_dice = parseInt(damage_dice[1]);

    //TODO: I'd like to be able to mark this as "[Forceful]" so it's possible to inspect it in the roll20 chat, but doing so messes up the macro somehow
    new_damage += `[[?{Attack|1st,0|2nd,1|3rd+,2}*${damage_dice}]]`;
    return new_damage;
}

function add_sweep(attack) {
    let new_attack = attack.get('current');
    if( typeof(new_attack) == 'number' ) {
        new_attack = new_attack.toString();
    }

    if( new_attack.indexOf('?{First Target Attacked?') != -1 ) {
        return null;
    }

    if(false == new_attack.endsWith('+')) {
        new_attack += '+';
    }
    //TODO: I'd like to be able to mark this as "[Sweep]" so it's possible to inspect it in the roll20 chat, but doing so messes up the macro somehow
    new_attack += `?{First Target Attacked?|Yes,0|No,1}`;
    return new_attack;
}

// Damage here is a string which may include dialogue box elements that we want to remove. They are always at
// the end though so it's fairly easy

function format_damage_for_display(damage) {
    let match = RegExp('\\s*\\+\\s*\\[\\[\\?{','ig').exec(damage);

    if( match == null  ){
        return damage;
    }

    return damage.substring(0, match.index);
}

function add_attacks(id, roll_type, roll_num, attack_type, message) {
    message.push(`{{roll0${roll_num}_name=${attack_type}}} `);
    //var num_attacks = getRepeatingSectionCounts(id,`repeating_${attack_type}-strikes`);
    const [IDs, attributes] = getRepeatingSectionAttrs(id,`repeating_${attack_type}-strikes`);
    var num_attacks = IDs.length;
    var show_bonus = true;
    var bonus_matcher = RegExp("\\+?(\\d+)");

    //var num_attacks = all_attrs.length;
    //log(num_attacks);
    //log(IDs);
    //log(attributes);
    //var roll_num = 1;

    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        log('jimbo ' + i);
        log(attrs);
        let name  = attrs['weapon'];
        if(name) {
            name = name.get('current');
        }
        else {
            name = "";
        }
        let bonus = attrs['weapon_strike'];
        let traits = attrs['weapon_traits'];
        if(traits) {
            traits = '**(' + traits.get('current') + ')**';
        }
        else {
            traits = "";
        }
        let damage = attrs['weapon_strike_damage'];
        if(damage) {
            if( traits.toLowerCase().includes('forceful') ) {
                //We want to add a bonus to damage
                let new_damage = add_forceful(damage);
                if( new_damage ) {
                    damage.set('current',new_damage);
                }
            }
            damage = format_damage_for_display(damage.get('current'));
        }
        else {
            damage = "";
        }
        let damage_type = attrs['weapon_strike_damage_type'];
        if(damage_type) {
            damage_type = damage_type.get('current');
        }
        else {
            damage_type = "";
        }
        //let bonus = getAttrByName(id, `repeating_${attack_type}-strikes_$${i}_weapon_strike`);
        //let traits = getAttrByName(id, `repeating_${attack_type}-strikes_$${i}_weapon_traits`);

        //&{template:rolls} {{charactername=@{character_name}}} {{header=@{weapon}}}
        //{{subheader=^{melee_strike}}} {{notes_show=@{roll_show_notes}}} {{notes=@{weapon_notes}}}
        //@{weapon_roll_npc} @{damage_roll_npc} @{damage_critical_roll_npc} @{damage_additional_roll_npc}

        if(bonus) {
            let new_bonus = bonus.get('current');
            if( typeof(new_bonus) == 'number' ) {
                new_bonus = new_bonus.toString();
            }
            //At this point we can check if the macro has been added to the weapon strike, and update it if not!
            if( new_bonus.indexOf('?{Attack') == -1 ) {
                //This means we take the bonus as correct and update the weapon strike with our macro, but we
                //first need to check if agile is one of the traits
                if(false == new_bonus.endsWith('+')) {
                    new_bonus += '+';
                }
                let map = 5;
                if( traits.toLowerCase().includes('agile') ) {
                    map = 4;
                }
                let pen_2 = -map;
                let pen_3 = -2*map;
                //TODO: I'd like to be able to mark this as "[MAP]" so it's possible to inspect it in the roll20 chat, but doing so messes up the macro somehow
                new_bonus += `[[?{Attack|1st,0|2nd ${pen_2},1|3rd+ ${pen_3},2}*(-${map})]]`
                bonus.set('current',new_bonus);
            }
        }
        if( traits.toLowerCase().includes('sweep') ) {
            let new_bonus = add_sweep(bonus);
            if( new_bonus ) {
                bonus.set('current', new_bonus);
            }
        }
        if( bonus ) {
            //now bonus has been updated to include the macro, we need a text version of it that starts with a +
            var bonus_match = bonus_matcher.exec(bonus.get('current'));
            bonus = "0";
            if(bonus_match && bonus_match.length > 1) {
                bonus = bonus_match[1];
            }
        }
        else {
            bonus = "0";
        }

        message.push(`{{${roll_type}0${roll_num}_name=[${name} +${bonus}](!&#13;&#37;{selected|repeating_${attack_type}-strikes_$${i}_ATTACK-DAMAGE-NPC})}} {{${roll_type}0${roll_num}=${damage} ${damage_type} ${traits}}}`);
        roll_num += 1
    }
    //message.push('}} ');
    return roll_num;
}

function show_attack_buttons(msg) {
    //we want to get all the attacks for the character given by id
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    //var character = getObj("character", id);
    var name = getAttrByName(id, 'character_name');

    //var attacks = getAttrByName(id, "repeating_npc-weapon_$1_macro-text-npc");
    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} Attacks}}`]
    var i = 1

    i = add_attacks(id, 'info', i, 'melee', message);
    add_attacks(id, 'info', i, 'ranged', message);

    log(message.join(" "));

    sendChat('GM', message.join(" ") );
}

function add_spells(id, roll_num, spell_type, spell_type_name, message) {

    //var num_attacks = getRepeatingSectionCounts(id,`repeating_${attack_type}-strikes`);
    const [IDs, attributes] = getRepeatingSectionAttrs(id,`repeating_${spell_type}`);
    var num_spells = IDs.length;
    if(num_spells == 0) {
        return roll_num;
    }
    message.push(`{{roll0${roll_num}_name=${spell_type_name}}} {{roll0${roll_num}=`);

    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        let name  = attrs['name'];
        if(name) {
            name = name.get('current');
        }
        else {
            name = "";
        }
        let level = attrs['current_level'];
        if(level) {
            level = level.get('current');
        }

        message.push(`[${name}](!&#13;&#37;{selected|repeating_${spell_type}_$${i}_npcspellroll})`);
    }
    message.push('}} ');
    return roll_num+1;
}

function add_full_spells(id, spell_type, spell_type_name, message) {

    //var num_attacks = getRepeatingSectionCounts(id,`repeating_${attack_type}-strikes`);
    const [IDs, attributes] = getRepeatingSectionAttrs(id,`repeating_${spell_type}`);
    var num_spells = IDs.length;
    if(num_spells == 0) {
        return roll_num;
    }
    spell_levels = {}
    for(var i = 1; i <= 10; i++ ) {
        spell_levels[i] = [];
    }
    var roll_num = 1;

    for(var i in IDs) {
        let attrs = attributes[IDs[i]];
        let name  = attrs['name'];

        if(name) {
            name = name.get('current');
        }
        else {
            name = "";
        }
        let level = attrs['current_level'];
        if(level) {
            level = level.get('current');
        }
        if(!(level >= 1 && level <= 10)) {
            level = 1;
        }
        //log('name=' + name + ' level=' + level)
        spell_levels[level].push(`[${name}](!&#13;&#37;{selected|repeating_${spell_type}_$${i}_npcspellroll}) `);
    }

    for(var i = 1; i <= 10; i++) {
        if(spell_levels[i].length == 0) {
            continue;
        }

        if(roll_num <= 8) {
            message.push(`{{info0${roll_num}_name=${spell_type_name} ${i}}} {{info0${roll_num}=`);
        }
        else {
            message.push(` **SPELLS ${i}**: `)
        }
        for(var button of spell_levels[i]) {
            message.push(button)
        }
        if(roll_num < 8) {
            message.push('}} ');
        }
        roll_num += 1;
    }
    if(roll_num > 8) {
        message.push('}} ');
    }
}

function show_spell_buttons(msg) {
    //we want to get all the attacks for the character given by id
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    //var character = getObj("character", id);
    var name = getAttrByName(id, 'character_name');

    //var attacks = getAttrByName(id, "repeating_npc-weapon_$1_macro-text-npc");
    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} Spells}}`]
    var i = 1

    i = add_spells(id, i, 'spellinnate', 'Innate', message);
    i = add_spells(id, i, 'spellfocus', 'Focus', message);
    i = add_spells(id, i, 'cantrip', 'Cantrips', message);
    add_full_spells(id, 'normalspells', 'Spells', message);

    log(message)

    sendChat('GM', message.join(" ") );
}

function show_secret_lore_buttons(id, msg) {
    //we want to get all the attacks for the character given by id
    //var character = getObj("character", id);
    var name = getAttrByName(id, 'character_name');
    //log(getRepeatingSectionAttrs(id, 'repeating_lore'));

    //var attacks = getAttrByName(id, "repeating_npc-weapon_$1_macro-text-npc");
    const [IDs, attributes] = getRepeatingSectionAttrs(id,'repeating_lore');

    //var num_abilities = getRepeatingSectionCounts(id,attr);

    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} Secret Lore}} `];

    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        //let name  = getAttrByName(id, `${attr}_$${i}_name`);
        let lore_name = attrs['lore_name'];
        if(lore_name) {
            lore_name = lore_name.get('current');
        }
        else {
            lore_name = 'unknown';
        }
        let bonus = attrs['lore'];
        if( bonus ) {
            bonus = bonus.get('current');
        }
        else {
            bonus = 0;
        }
        let n = parseInt(i)+1;
        message.push(`{{info0${n}_name=**${lore_name}**}} {{info0${n}=[**Roll**](!secret {{id=${id}&#125;} {{bonus=${bonus}&#125;} {{name=${lore_name} Lore&#125;!&#13;/me rolls a secret ${lore_name} Lore check...)}}`);
    }

    sendChat('GM', message.join(" "));
}

function show_generic_ability_buttons(msg, attr, type) {
    //we want to get all the attacks for the character given by id
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    //var character = getObj("character", id);
    var name = getAttrByName(id, 'character_name');

    //var attacks = getAttrByName(id, "repeating_npc-weapon_$1_macro-text-npc");

    var num_abilities = getRepeatingSectionCounts(id,attr);

    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} ${type}}} {{roll01=`]

    for(var i = 0; i < num_abilities; i++) {
        let name  = getAttrByName(id, `${attr}_$${i}_name`);
        message.push(`[${name}](!&#13;&#37;{selected|${attr}_$${i}_action-npc})`);
    }

    sendChat('GM', message.join(" ") + '}}');
}

function show_ability_buttons(msg) {
    show_generic_ability_buttons(msg, "repeating_actions-activities", "Abilities");
    show_generic_ability_buttons(msg, "repeating_interaction-abilities", "Interaction Abilities");
}

function show_reaction_buttons(msg) {
    show_generic_ability_buttons(msg, "repeating_free-actions-reactions", "Reactions & Free-actions");
}

function get_list_buttons(msg, list_name, list) {
    //we want to get all the attacks for the character given by id
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    var name = getAttrByName(id, 'character_name');

    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} ${list_name}}} {{desc=`]

    for(var i in list) {
        message.push(`[${list[i]}](!&#13;&#37;{selected|${list[i]}})`);
    }
    return message;
}

function show_list_buttons(message) {
    message = message.join(" ") + '}}';

    sendChat('GM', message);
}


function show_skills_buttons(msg) {
    var skill_names = ['ACROBATICS', 'ARCANA', 'ATHLETICS', 'CRAFTING', 'DECEPTION', 'DIPLOMACY', 'INTIMIDATION',
    'MEDICINE', 'NATURE', 'OCCULTISM', 'PERFORMANCE', 'RELIGION', 'SOCIETY', 'STEALTH', 'SURVIVAL', 'THIEVERY'];
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    let message = get_list_buttons(msg, 'Skills', skill_names);

    //Also add any lores we might have
    const [IDs, attributes] = getRepeatingSectionAttrs(id,'repeating_lore');
    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        //let name  = getAttrByName(id, `${attr}_$${i}_name`);
        let lore_name = attrs['lore_name'];
        if(lore_name) {
            lore_name = lore_name.get('current');
        }
        message.push(`[${lore_name}](!&#13;&#37;{selected|repeating_lore_${IDs[i]}_LORE})`);
    }
    log(message);
    show_list_buttons(message);
}

function show_save_buttons(msg) {
    let message = get_list_buttons(msg, 'Saves', ['FORT', 'REF', 'WILL']);
    show_list_buttons(message);
}

function show_ability_check_buttons(msg) {
    message = get_list_buttons(msg, 'Ability Checks', ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
    show_list_buttons(message);
}

on('change:campaign:turnorder', function() {
    try {
        var turnorder = Campaign().get("turnorder");
        if(turnorder == "")
            return;
        turnorder = JSON.parse(turnorder);

        //Get the person at the top of the order
        log('jim');
        log(turnorder[0]['id']);
        turn_off_marker_token(turnorder[0]['id'], 'Reaction');
    }
    catch(err) {
        log(err);
        log('why');
    }
});

on('change:campaign:initiativepage', function() {
    try {
        var turnorder_visible = Campaign().get("initiativepage");
        if( turnorder_visible ) {
            play('roll_for_initiative');
        }
    }
    catch(err) {
        log(err);
    }
});
