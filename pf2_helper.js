var module_name = 'PF2 Helper';
var module_version = 'v1.06';

var skill_names = ['PERCEPTION', 'ACROBATICS', 'ARCANA', 'ATHLETICS', 'CRAFTING', 'DECEPTION', 'DIPLOMACY',
                   'INTIMIDATION', 'MEDICINE', 'NATURE', 'OCCULTISM', 'PERFORMANCE', 'RELIGION', 'SOCIETY',
                   'STEALTH', 'SURVIVAL', 'THIEVERY'];

function get_index(msg) {
    var roll_match = RegExp("\\$\\[\\[(\\d+)\\]\\]");

    var index = roll_match.exec(msg);
    if( null == index ) {
        return null;
    }
    return parseInt(index[1], 10);
}

function set_attribute(id, attr_name, value) {
    var attrs = findObjs({type : 'attribute', characterid:id, name:attr_name});
    for (var ob of attrs) {
        ob.remove();
    }
    createObj("attribute", {name:attr_name, current:value, max:value, characterid: id});
}

function get_attribute(id, attr_name) {
    let objs = findObjs({type : 'attribute', characterid:id, name:attr_name});
    if( objs.length == 0 ) {
        log('no attribute darn: ' + attr_name);
        return undefined;
    }
    return objs[0].get('current');
}

function parse_roll(to_hit, die_result, threat) {
    if(die_result == 1) {
        return '[[1d1cs>2]] Fumble';
    }
    else if(die_result == 20) {
        return '[[1d1cf<0cs>1*20]] Natural Twenty!';
    }
    else {
        return `[[${to_hit}]]`;
    }
}

function title_case(text) {
    return text.replace(
        /(\w)(\w*)/g,
        (_, firstChar, rest) => firstChar.toUpperCase() + rest.toLowerCase()
    );
}

class Attack {
    constructor(to_hit, damage, additional_damage, damage_type, die_result, extra_crit_damage, fatal) {
        this.to_hit = to_hit;
        this.damage = damage + additional_damage;
        if(fatal) {
            this.crit_damage = `((${fatal} + ${additional_damage}[additional damage])*2)`;
        }
        else {
            this.crit_damage = this.damage*2;
        }
        this.damage_type = damage_type;
        this.extra_crit_damage = extra_crit_damage;
        this.die_result = die_result;
        if( die_result == 20 ) {
            play('critical_threat');
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
            damage = `{{roll02_name=^{damage}}} {{roll02=[[${this.damage}]]}} {{roll02_type=damage}} ${damage_type} {{roll03_name=^{critical_damage}}} {{roll03=[[${this.crit_damage} + ${this.extra_crit_damage}]]}} {{roll03_type=critical-damage}}`;
        }
        return `{{roll01_name=^{attack}}} ${to_hit} ${damage}`;
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
            this.name = 'Strange Creature';
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
        var damage = rolls.damage.roll.results.total;
        var to_hit = rolls.attack.roll.results.total;
        var die_result = rolls.attack.roll.results.rolls[0].results[0].v;
        var damage_type = rolls.damage.info;
        var additional_damage = 0;
        if('damage_additional' in rolls) {
            additional_damage += rolls.damage_additional.roll;
            if(rolls.damage_additional.info) {
                damage_type += ', ' + rolls.damage_additional.info;
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
            var old_dice = RegExp("(\\d+)d(\\d+)","g").exec(rolls.damage.roll.expression);
            if( old_dice.length > 2 ) {
                var num_old = parseInt(old_dice[1]);

                var new_dice = `${num_old}${match[1]}`;
                fatal = rolls.damage.roll.expression.replace(old_dice[0],new_dice);
                if(extra_crit) {
                    extra_crit += '+' + `1${match[1]}`;
                }
                else {
                    extra_crit = `1${match[1]}`;
                }
            }
        }

        self.attack = new Attack(to_hit, damage, additional_damage, damage_type, die_result, extra_crit, fatal);
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
        var damage;
        var damage_type;
        var to_hit;
        var die_result;

        if('damage' in rolls) {
            damage = rolls.damage.roll.results.total;
            damage_type = rolls.damage.info;
        }
        if('attack' in rolls) {
            to_hit = to_hit = rolls.attack.roll.results.total;
            die_result = rolls.attack.roll.results.rolls[0].results[0].v;
        }
        else {
            return;
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
            `{{roll01_type=([^}]*)}}.*`;
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
        return `&{template:rolls} {{header=${this.name} ${this.header}}} {{subheader=${this.subheader}}}` +
            `{{roll01=${this.result}}} {{roll01_type=${this.type}} {{notes_show=0}}`;
    }
}

class Save extends BasicRoll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'saving-throw';
    }
}

class AbilityCheck extends BasicRoll {
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'ability';
    }
}

class Skill extends BasicRoll{
    constructor(content, inlinerolls) {
        super(content, inlinerolls);
        this.type = 'skill';
    }
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
	if (attrName.search(regExp) === 0) {
            repeatingAttrs[attrName] = o;
        }
	else if (attrName === `_reporder_${prefix}`) {
            repOrder = o.get('current').split(',');
        }
    });

    if (!repOrder) {
        repOrder = [];
    }
    // Get list of repeating row ids by prefix from repeatingAttrs
    const unorderedIds = [...new Set(Object.keys(repeatingAttrs)
		                     .map(n => n.match(regExp))
		                     .filter(x => !!x)
		                     .map(a => a[1]))];

    const repRowIds = [...new Set(repOrder.filter(x => unorderedIds.includes(x)).concat(unorderedIds))];
    const wtf_functional_madness = {};
    for(var o in repeatingAttrs) {
        if( !o ) {
            continue;
        }
        var match = regExp.exec(o);

        if( !(match[1] in wtf_functional_madness) ) {
            wtf_functional_madness[match[1]] = {};
        }
        wtf_functional_madness[match[1]][match[2]] = repeatingAttrs[o];
    }

    return [repRowIds, wtf_functional_madness];
};

function canonical_lore_name(name) {
    //try to rationalise them a bit to guard against different spacing etc
    lore_parts = name.split(/\s+/g);
    if( lore_parts.length > 0 && lore_parts[lore_parts.length - 1].toLowerCase() != 'lore' ) {
        lore_parts.push('Lore');
    }
    for( var j = 0; j < lore_parts.length; j++) {
        lore_parts[j] = title_case(lore_parts[j]);
    }

    return lore_parts.join(' ');
}
function roll_secret_skill(msg) {
    let characters = [];
    for( var obj_id of msg.selected ) {
        //Grab the character represented by these
        var obj = getObj(obj_id._type, obj_id._id);
        if( !obj ) {
            continue;
        }
        var character = getObj('character', obj.get('represents'));
        characters.push(character);
    }
    let matches=RegExp("{{skill=([^}]*)}}","g").exec(msg.content);
    let skill = matches[1];
    let skill_upper = skill.toUpperCase();
    let is_lore = false;
    if( skill.toLowerCase().endsWith('lore') ) {
        is_lore = true;
    }

    // We'll do the output differently depending on if we have just one or not. For a single roll we'll do the
    // normal macro
    if( false == playerIsGM(msg.playerid) ) {
        sendChat(msg.who, `/me rolls a secret ${skill} check...`);
    }
    let message = [`/w GM &{template:rolls} {{header=Secret ${skill}}}`];
    for( var i = 0; i < characters.length; i++) {
        let bonus = 0;
        let has_lore = false;
        let rank = 0;
        let sheet_type = getAttrByName(characters[i].id, 'sheet_type');

        if( is_lore ) {
            // Getting the bonus here is a little different. We need to loop through the lores of this
            // character and see if any of the names match this one
            const [IDs, attributes] = getRepeatingSectionAttrs(characters[i].id,'repeating_lore');

            for(var j in IDs) {
                if( !j ) {
                    continue;
                }
                let attrs = attributes[IDs[j]];
                let lore_name = attrs.lore_name;

                if(lore_name) {
                    lore_name = canonical_lore_name(lore_name.get('current'));
                }

                if(lore_name && lore_name.toLowerCase().trim() == skill.toLowerCase().trim()) {
                    bonus = attrs.lore;

                    if( !bonus ) {
                        continue;
                    }

                    bonus = bonus.get('current');
                    has_lore = true;
                    let lore_rank = attrs.lore_rank;
                    log('checking lore_rank ');
                    log(lore_rank);
                    if( sheet_type != 'npc' && lore_rank ) {
                        rank = parseInt(lore_rank.get('current'));
                        log('rank ' + rank);
                    }
                }
            }
            if( false == has_lore ) {
                //We should just use our intelligence bonus
                bonus = getAttrByName(characters[i].id, 'intelligence_modifier');
            }
        }
        else {
            bonus = getAttrByName(characters[i].id, skill);
            rank = getAttrByName(characters[i].id, `${skill_upper}_rank`);
        }
        let name = getAttrByName(characters[i].id, 'character_name');

        while(bonus && bonus.startsWith != undefined && bonus.startsWith('+')) {
            bonus = bonus.slice(1);
        }
        if( isNaN(bonus) ) {
            sendChat(module_name, `/w GM Invalid skill bonus ${bonus} for ${name}`);
            continue;
        }
        bonus = parseInt(bonus);
        message.push(`{{roll0${i+1}=[[1d20+${bonus}]]}} {{roll0${i+1}_name=${name}}}`);
        if( sheet_type != 'npc' ) {
            //We can also stick the characters training with the skill on for players
            var ranks = { 0 : 'Untrained' ,
                          2 : 'Trained',
                          4 : 'Expert',
                          6 : 'Master',
                          8 : 'Legendary' };
            rank = ranks[rank];
            if( !rank ) {
                rank = 'Untrained';
            }
            message.push(`{{roll0${i+1}_info=${rank}}}`);
        }
        else if ( is_lore && false == has_lore ) {
            //we'll also tell the GM if the NPC is not at least trained in the lore skill in question
            message.push(`{{roll0${i+1}_info=Untrained}}`);
        }
    }
    sendChat(module_name,message.join(' '));
}

function roll_secret(msg) {
    var bonus_str = RegExp("{{bonus=([^}]*)}}").exec(msg.content)[1];
    if( !bonus_str ) {
        sendChat(module_name, `/w ${msg.who} Invalid secret macro invocation; no bonus provided`);
        return;
    }
    while(bonus_str.startsWith('+')) {
        bonus_str = bonus_str.slice(1);
    }
    var bonus = parseInt(bonus_str);
    if( isNaN(bonus) ) {
        sendChat(module_name, `/w ${msg.who} Invalid input ${bonus_str}`);
        return;
    }
    if( false == playerIsGM(msg.playerid) ) {
        sendChat(msg.who, `/me rolls a secret check with bonus ${bonus}...`);
    }
    sendChat(module_name, `/w GM &{template:rolls} {{header=Secret Roll}} {{subheader=For ${msg.who}}} {{roll01=[[1d20+${bonus}]]}}`);
}

function parse_expressions(damage_string) {
    // We want 2d6+10 plus 1d6 fire and 2d6 evil to return
    //
    // {normal : 2d6+10,
    //  extra  : [[1d6]] fire and [[2d6]] evil}
    //
    let expressions = [];
    let dice_positions = [];
    let pos = 0;
    let num_trials = 0;
    while(pos < damage_string.length) {
        let re = RegExp('(\\d+d\\d+)','ig');
        let match = re.exec(damage_string);
        let expr = [];
        let last = 0;

        while(1) {
            //we always take the dice expression

            if(match == null || last != match.index) {
                //we've got some inbetween to look at. If this has got anything other than +-numbers with possible whitespace then we're done
                var end = undefined;
                if( match ) {
             	    end = match.index;
                }
                let between = damage_string.substring(last, end);
                let between_re = RegExp('(^[+-\\d\\s]+)','g');
                let between_match = between_re.exec(between);
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
           };
}

function parse_damage(damage_string) {
    let data = parse_expressions(damage_string);
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
    let type_parts = type.split(' ');
    let type_end = 0;
    for(i = 0; i < type_parts.length; i++) {
        let part_lower = type_parts[i].toLowerCase();
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

    if(damage == undefined) {
        // Sometimes we don't find any damage. For example, an alchemist will have "bomb + 8 damage varies by
        // bomb". No roll at all. In that case we'll pick up the text as additional, but really it should go
        // into damage and have no additional
        damage = '0';
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
        var new_on = [];
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
        var new_on = [];
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

        let name = getAttrByName(character.id, 'character_name');
        let ac = get_attribute(character.id, 'armor_class');

        token.set('name', `${name} AC:${ac}`);
        token.set('showname', true);

        if( focus && focus.get('max') > 0 ) {
            token.set('bar2_value', focus.get('current'));
            token.set('bar2_max', focus.get('max'));
        }
        setDefaultTokenForCharacter(character, token);
    }
}

function play(title) {
    if( !state.pf2_helper.sounds ) {
        return;
    }
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
                     };

    let set_int = {'level'       : 'level',
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
                     'thievery'     : 'thievery_notes',
                     'ac'           : 'armor_class_notes',
                     'hp'           : 'hit_points_notes',
                    };

    var spells      = false;
    var cantrips    = false;
    var focusspells = false;
    var innate      = false;
    var prepared    = false;
    var spontaneous = false;
    let spell_reporder = {};
    let lore_reporder = [];
    let item_reporder = [];

    for( var key of Object.keys(set_value) ) {
        set_attribute(character.id, set_value[key], '');
    }
    for( key of Object.keys(set_int) ) {
        set_attribute(character.id, set_int[key], '');
    }
    for( key of Object.keys(set_notes) ) {
        set_attribute(character.id, set_notes[key], '');
    }

    //Let's delete all the strikes
    delete_repeating(character.id, 'repeating_melee-strikes');
    delete_repeating(character.id, 'repeating_ranged-strikes');
    delete_repeating(character.id, 'repeating_free-actions-reactions');
    delete_repeating(character.id, 'repeating_actions-activities');
    delete_repeating(character.id, 'repeating_interaction-abilities');
    delete_repeating(character.id, 'repeating_normalspells');
    delete_repeating(character.id, 'repeating_spellinnate');
    delete_repeating(character.id, 'repeating_spellfocus');
    delete_repeating(character.id, 'repeating_cantrip');
    delete_repeating(character.id, 'repeating_lore');
    delete_repeating(character.id, 'repeating_items-worn');
    disable_spellcaster(character.id);
    set_attribute(character.id, 'sheet_type', 'npc');
    set_attribute(character.id, 'spellcaster_prepared', '0');
    set_attribute(character.id, 'spellcaster_spontaneous', '0');
    set_attribute(character.id, 'roll_option_critical_damage','none');
    let whisper_type;
    if( state.pf2_helper.hide_rolls ) {
        whisper_type = '/w gm ';
    }
    else {
        whisper_type = '0';
    }
    set_attribute(character.id, 'whispertype',whisper_type);
    set_attribute(character.id, 'roll_show_notes','[[1]]');

    for( key of Object.keys(data) ) {
        if( key == 'name' ) {
            //This one isn't an attribute, it's special
            character.set('name', title_case(data[key]));
        }
        else if( key == 'speed' ) {
            let match = RegExp('^\\s*(\\d+)?( feet)?(.*)','i').exec(data[key]);
            if( match ) {
                let speed = '0';
                let notes = '';
                if( match[1] ) {
                    speed = match[1];
                    if( match[2] ) {
                        speed += match[2];
                    }
                }
                if( match[3] ) {
                    notes = match[3];
                    if( notes[0] == ',' || notes[0] == ';' ) {
                        notes = notes.slice(1).trim();
                    }
                }
                set_attribute(character.id, 'speed', speed);
                set_attribute(character.id, 'speed_notes', notes);
            }
        }
        else if( key == 'perception' ) {
            //This one is a bit odd as it has a notes field that sets senses
            set_attribute(character.id, 'perception', data[key].value);
            if( data[key].note ) {
                set_attribute(character.id, 'senses', data[key].note);
            }
        }
        else if( key in set_string ) {
            set_attribute(character.id, set_string[key], title_case(data[key]));
        }
        else if( key in set_int ) {
            set_attribute(character.id, set_int[key], data[key]);
        }
        else if( key in set_value && data[key].value ) {
            set_attribute(character.id, set_value[key], data[key].value);
        }

        if( key in set_notes && data[key].note ) {
            set_attribute(character.id, set_notes[key], data[key].note);
        }

        else if( key == 'strikes' ) {
            let reporder = {'repeating_melee-strikes'  : [],
                            'repeating_ranged-strikes' : [],
                           };
            for( var strike of data[key] ) {
                let id = generate_row_id();
                let prefix = '';

                if( strike.type == 'Melee' ) {
                    prefix = 'repeating_melee-strikes';
                }
                else if( strike.type == 'Ranged' ) {
                    prefix = 'repeating_ranged-strikes';
                }
                else {
                    continue;
                }
                let stub = `${prefix}_${id}_`;
                let damage = parse_damage(strike.damage);
                if( null == damage ) {
                    continue;
                }
                set_attribute(character.id, stub + 'weapon', strike.name);
                set_attribute(character.id, stub + 'weapon_strike', strike.attack);
                set_attribute(character.id, stub + 'weapon_traits', strike.traits);
                set_attribute(character.id, stub + 'weapon_strike_damage', damage.damage);
                set_attribute(character.id, stub + 'weapon_strike_damage_type', damage.type);
                set_attribute(character.id, stub + 'weapon_strike_damage_additional', damage.additional);
                set_attribute(character.id, stub + 'roll_critical_damage_npc', ' ');
                if( strike.notes ) {
                    set_attribute(character.id, stub + 'weapon_notes', strike.notes);
                }
                set_attribute(character.id, stub + 'toggles', 'display,');
                reporder[prefix].push(id);
            }
            for( key of Object.keys(reporder) ) {
                set_attribute(character.id, '_reporder_' + key, reporder[key].join(','));
            }
        }

        else if( key == 'specials' ) {
            let reporder = {'repeating_interaction-abilities'  : [],
                            'repeating_free-actions-reactions' : [],
                            'repeating_actions-activities' : [],
                           };
            for(var special of data[key]) {
                let id = generate_row_id();

                let action = special.actions;
                let prefix = '';
                if( special.type == 'general' ) {
                    prefix = 'repeating_interaction-abilities';
                }
                else if( special.type == 'defense' ) {
                    prefix = 'repeating_free-actions-reactions';
                }
                else if( special.type == 'offense' ) {
                    prefix = 'repeating_actions-activities';
                }
                else {
                    log("Unknown ability type: " + special.type);
                    continue;
                }
                let stub = `${prefix}_${id}_`;

                if( action == 'none' || action == 'reaction' || action == 'free' ) {
                    //This should go in the automatic or reactive abilities sections
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
                    set_attribute(character.id, stub + 'actions', action);
                }
                else {
                    continue;
                }

                let description = special.description;
                if( special.name.toLowerCase() == 'attack of opportunity' && description == '' ) {
                    description = 'You lash out at a foe that leaves an opening. Make a melee Strike against the triggering creature. If your attack is a critical hit and the trigger was a manipulate action, you disrupt that action. This Strike doesn’t count toward your multiple attack penalty, and your multiple attack penalty doesn’t apply to this Strike. ';
                }
                description.replace('&nbsp;','\n');
                set_attribute(character.id, stub + 'name', special.name);

                set_attribute(character.id, stub + 'rep_traits', special.traits);
                set_attribute(character.id, stub + 'description', description);
                set_attribute(character.id, stub + 'toggles', 'display,');
                reporder[prefix].push(id);
            }
            for( key of Object.keys(reporder) ) {
                set_attribute(character.id, '_reporder_' + key, reporder[key].join(','));
            }
        }
        else if( key == 'spells' || key == 'morespells' ) {
            //We've got some spells. Firsty we need to turn on the spellcaster options.
            let spell_data = [];
            let spell_type_key = 'spelltype';
            if( key == 'spells' ) {
                spell_data = [data];
            }
            else {
                spell_data = data.morespells;
                spell_type_key = 'name';
                // The input can have a different DC and attack roll here, but the roll20 sheet doesn't
                // support it so we ignore it
            }

            for( var spell_datum of spell_data ) {
                let spell_type = spell_datum[spell_type_key];
                if( spell_type ) {
                    spell_type = spell_type.toLowerCase();
                }

                var this_focus = spell_datum.focuspoints != undefined && spell_datum.focuspoints != '';

                if( this_focus ) {
                    //We need to set the number of focus points too
                    set_attribute(character.id, 'focus_points', parseInt(spell_datum.focuspoints));
                }

                var stub = `repeating_normalspells`;
                if( this_focus ) {
                    // If they cost focus points we put them in the focus spells section
                    stub = 'repeating_spellfocus';
                }
                else if (spell_type.toLowerCase().indexOf('innate') != -1) {
                    stub = 'repeating_spellinnate';
                    innate = true;
                }
                //What is the tradition?
                let tradition = '';
                if( spell_type ) {
                    for( var trad of ['arcane','occult','divine','primal'] ) {
                        if( spell_type.indexOf(trad) != -1 ) {
                            tradition = trad;
                            break;
                        }
                    }
                }

                for(var i = 0; i < 11; i++) {
                    if( spell_datum.spells[i] ) {
                        spells = true;

                        //We're throwing some spells in!
                        let level = 10 - i;
                        let this_stub = stub;
                        if( level == 0 ) {
                            //cantrips
                            this_stub = `repeating_cantrip`;
                            level = spell_datum.cantriplevel;
                            //oddly the cantrip level field is called "cantrips_per_day"
                            set_attribute(character.id, 'cantrips_per_day', level);
                            cantrips = true;
                        }

                        else if( this_focus ) {
                            focusspells = true;
                        }

                        //If they're a spontaneous caster we expect it to tell us how many slots
                        let spell_info = spell_datum.spells[i];
                        let slot_info_re = /^\s*\((\d+) slots\)/i;
                        let slot_info = slot_info_re.exec(spell_info);
                        if( slot_info ) {
                            spontaneous = true;
                            spell_info = spell_info.slice(slot_info_re.lastIndex);
                            if( slot_info[1] ) {
                                set_attribute(character.id, `level_${level}_per_day`, slot_info[1]);
                            }
                        }
                        else if( level > 0 && !this_focus ) {
                            //If there any non-cantrip spells that don't include a number of slots, then
                            //they're a spontaneous spellcaster
                            prepared = true;
                        }
                        //Rather than split on commas, we need to be a bit more careful, because of something
                        //  like this on the balisse:
                        // 2nd invisibility (at will, self only)
                        let spell_names = [];

                        while(spell_info) {
                            let next_comma = spell_info.indexOf(',');
                            let next_paren = spell_info.indexOf('(');
                            if( next_comma == -1 ) {
                                spell_names.push(spell_info);
                                break;
                            }
                            if( next_paren == -1 || next_comma < next_paren ) {
                                spell_names.push(spell_info.slice(0, next_comma));
                                spell_info = spell_info.slice(next_comma + 1);
                                continue;
                            }
                            //There's a bracket next before the next comma, go until closed
                            let num_open = 1;
                            for(var n = next_paren + 1; n < spell_info.length; n++) {
                                if( spell_info[n] == '(' ) {
                                    num_open += 1;
                                }
                                else if( spell_info[n] == ')' ) {
                                    num_open -= 1;
                                    if( num_open == 0 ) {
                                        break;
                                    }
                                }
                            }
                            //n now has the position of the closing brace...
                            if( n >= spell_info.length || spell_info.slice(n).indexOf(',') == -1 ) {
                                spell_names.push(spell_info);
                                break;
                            }
                            //There's another comma after the closing brace!
                            next_comma = n + spell_info.slice(n).indexOf(',');
                            spell_names.push(spell_info.slice(0, next_comma));
                            spell_info = spell_info.slice(next_comma + 1);
                        }

                        //var spell_names = spell_info.split(', ');
                        for( var spell_name of spell_names ) {
                            if( spell_name.trim() == '' ) {
                                continue;
                            }
                            let id = generate_row_id();
                            set_attribute(character.id, this_stub + `_${id}_` + 'name', spell_name);
                            set_attribute(character.id, this_stub + `_${id}_` + 'current_level', level);
                            set_attribute(character.id, this_stub + `_${id}_` + 'toggles', 'display,');
                            if( tradition ) {
                                set_attribute(character.id, this_stub + `_${id}_` + 'magic_tradition', tradition);
                            }
                            if( spell_reporder[stub] == undefined ) {
                                spell_reporder[stub] = [];
                            }
                            spell_reporder[stub].push(id);
                        }
                    }
                }
            }
        }
        else if( key.startsWith('lore') ) {
            // monster.pf2.tools uses "lore" and "lorealt", and we extend that with "lore2", "lore3",...
            if( key != 'lore' && key != 'lorealt' ) {
                //Check for one of our extra lores
                let n = parseInt(key.slice(4));
                if( isNaN(n) ) {
                    continue;
                }
            }
            //Otherwise it's good and we need a new lore
            let id = generate_row_id();
            let stub = 'repeating_lore';
            set_attribute(character.id, stub + `_${id}_` + 'lore_name', data[key].name);
            set_attribute(character.id, stub + `_${id}_` + 'lore', data[key].value);
            if( data[key].note ) {
                set_attribute(character.id, stub + `_${id}_` + 'lore_notes', data[key].note);
            }
            lore_reporder.push(id);
        }
        else if( key == 'savenote' ) {
            // Roll20 has only one save notes field, even though we can have notes on specific
            // saves, so we'd best collect them up here
            let notes = data[key];
            let saves = ['fortitude','reflex','will'];
            let saves_short = ['Fort','Ref','Will'];
            for( let i = 0; i < saves.length; i++ ) {
                if( data[saves[i]] && data[saves[i]].note ) {
                    notes += `; ${saves_short[i]}: ${data[saves[i]].note}`;
                }
            }
            set_attribute(character.id, 'saving_throws_notes', notes);
        }
        else if( key == 'items' ) {
            for( var item of data[key].split(',') ) {
                let item_name = item.trim();
                let id = generate_row_id();
                let stub = 'repeating_items-worn';
                set_attribute(character.id, stub + `_${id}_` + 'worn_item', item_name);
                set_attribute(character.id, stub + `_${id}_` + 'description', '');
                set_attribute(character.id, stub + `_${id}_` + 'toggles', 'display,');
                item_reporder.push(id);
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
        if( prepared ) {
            set_attribute(character.id, 'spellcaster_prepared', 'prepared');
        }
        if( spontaneous ) {
            set_attribute(character.id, 'spellcaster_spontaneous', 'spontaneous');
        }
    }
    for( key of Object.keys(spell_reporder) ) {
        set_attribute(character.id, '_reporder_' + key, spell_reporder[key].join(','));
    }
    set_attribute(character.id, '_reporder_repeating_lore', lore_reporder.join(','));
    set_attribute(character.id, '_reporder_repeating_items-worn', item_reporder.join(','));
    set_attribute(character.id, 'npc_type','Creature');
    set_attribute(character.id, 'sheet_type', 'npc');
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

var non_principals = ['a','an','the','in','with','by','of','on','and','or','but','to'];

function format_ability_description(input, breaks) {
    // In an ability some words should be bolded, and roll20 supports markdown syntax for that, so let's give
    // it a go

    //Now just to insert newlines into the string at those points...
    let broken_string = [];
    let pos = 0;
    for( var break_pos of breaks ) {
        broken_string.push(input.slice(pos, break_pos));
        pos = break_pos;
    }
    broken_string.push(input.slice(pos));
    input = broken_string.join('\n');

    input = input.replace(/\nCritical Success /g,'\n**Critical Success** ');
    input = input.replace(/\nSuccess /g,'\n**Success** ');
    input = input.replace(/\nCritical Failure /g,'\n**Critical Failure** ');
    input = input.replace(/\nFailure /g,'\n**Failure** ');
    input = input.replace(/Maximum Duration/g,'**Maximum Duration**');
    input = input.replace(/Saving Throw/g,'**Saving Throw**');
    input = input.replace(/Trigger/g,'**Trigger**');
    input = input.replace(/Effect/g,'**Effect**');
    input = input.replace(/Requirements/g,'**Requirements**');
    input = input.replace(/Stage 1/g,'**Stage 1**');
    input = input.replace(/Stage 2/g,'**Stage 2**');
    input = input.replace(/Stage 3/g,'**Stage 3**');

    let data = parse_expressions(input);
    if( data && data.dice.length > 0 ) {
        let output = [];
        for( var i = 0; i < data.parts.length; i++ ) {
            output.push(data.parts[i]);
            if( data.dice.indexOf(i) != -1 ) {
                output.push(`([[${data.parts[i].trim()}]]) `);
            }
        }
        input = output.join('');
    }

    return input;
}

function num_title_case(words) {
    if( words && words[0] && false == is_upper_case(words[0][0]) ) {
        return 0;
    }
    for(var i = 0; i < words.length; i++) {
        if( false == is_upper_case(words[i][0]) && (non_principals.indexOf(words[i]) == -1) ) {
            return i;
        }
    }
    return words.length;
}

//These abilities weirdly start with a lower case latter
var lower_case_abilities = ['Golem Antimagic'];

function num_in_title(words) {
    let n = num_title_case(words);
    //words which ought never appear in an ability name
    let non_title_words = ['DC'];

    // num_title_case is likely to include the first word of the ability description because it probably
    // starts with a capital, but it might not if it's one of the non-principals. We know the ability
    // description must start with a capital letter regardless, so step backwards until that is satisfied
    while(n > 0 && words[n] && is_lower_case(words[n][0]) ) {
        n -= 1;
    }

    //Golem Antimagic (and possibly other template-style) abilities don't start their ability blocks with a capital letter.

    for( var silly_ability of lower_case_abilities ) {
        if( words.slice(0, n+1).join(" ").indexOf(silly_ability) != -1 ) {
            n += 1;
            break;
        }
    }

    // Next we know that some words will never appear in an ability name (like DC)
    for(var i = 0; i < n; i++) {
        if( non_title_words.indexOf(words[i]) != -1 ) {
            n = i;
            break;
        }
    }

    return n;
}

function new_ability(description_data, ability_type) {
    let description = description_data.line;
    let output = {type : ability_type};
    let traits = '';
    let action = 'none';
    let action_names = {'[one-action]' : 'one',
                        '[two-actions]': 'two',
                        '[three-actions]' : 'three',
                        '[reaction]' : 'reaction',
                        '[free-action]' : 'free'};

    //To get the name we go until the first non-caps word. That might fail if the start of the sentance after
    //the name is in title case


    let words = description.split(' ');
    var i = num_in_title(words);

    let title_end = i;
    let trait_start = i;
    let description_start = i;

    if( i >= 1 && i < words.length ) {
        if( words[i][0] == '[' ) {
            //This is probably the action type
            if( words[i] in action_names ) {
                action = action_names[words[i]];
                title_end = i;
                trait_start = i+1;
                description_start = i+1;
            }
        }

        if( words[trait_start] && words[trait_start][0] == '(') {
            //blah
        }
        else if( action == 'none' ) {
            //title_end = i - 1;
            //description_start = i - 1;
            trait_start = null;
        }
    }

    description = words.slice(description_start).join(' ');
    let offset = 0;
    for(i = 0; i < description_start; i++) {
        offset += words[i].length + 1;
    }

    if( trait_start != null ) {
        //We've got some traits
        let re = /^.*?\((.*?)\)/g;
        let match = re.exec(description);

        if( match && match[1] ) {
            traits = match[1];
            description = description.slice(re.lastIndex);
            offset += re.lastIndex;

            //Now we're going to trim it, but we'd best update our offsets if we take anything off the front
            let old_len = description.length;
            description = description.replace(/^\s+/,"");
            offset += old_len - description.length;
        }
    }

    for(i = 0; i < description_data.breaks.length; i++) {
        description_data.breaks[i] -= offset;
    }

    let name = words.slice(0, title_end).join(' ');

    // For traits if the first thing after the name are brackets, then those are the traits

    output.name = name;
    output.traits = traits;
    output.actions = action;
    output.description = format_ability_description(description, description_data.breaks);

    return output;
}

function join_ability_lines(lines) {
    // We're basically doing a "lines.join(' ')", but we also want to include a list of positions that need
    // line-breaks reinserting, because of the "critical success: " type blocks that shouldn't be collected
    // all onto one line
    let output = {line : '', breaks : []};
    if( lines.length < 1 ) {
        return output;
    }

    //First strip whitespace from the start of the first line so we don't mess up our offsets
    lines[0] = lines[0].replace(/^\s+/,"");
    let pos = 0;
    for( var line of lines ) {
        if( line.startsWith('Critical Success ') ||
            line.startsWith('Success ') ||
            line.startsWith('Failure ') ||
            line.startsWith('Critical Failure ') ) {
            output.breaks.push(pos);
        }
        pos += line.length + 1;
    }
    output.line = lines.join(' ');
    return output;
}

function load_pdf_data(input) {
    input = input.replace(/&nbsp;/g,' ');
    input = input.replace(/(<p[^>]+?>|<p>|<div>)/ig, "");
    //Paizo sometimes uses weird symbols for minus
    input = input.replace(/–/g,'-');

    //The GMG uses unicode instead of symbols
    input = input.replace(/\ue904/ug,'[reaction]');
    input = input.replace(/\ue902/ug,'[one-action]');


    // The main challenge of this function is deciding which line breaks are there intentionally (as they
    // start a new ability), and which are just for word wrapping. There are a lot of heuristics and edge
    // cases that go into it, so the last thing we want to do is throw in more line breaks, but there is one
    // issue we need to handle. Specifically, some of the essential blocks (AC, HP and Ability scores) don't
    // always start a line, for example the shield archon omits the line break before the ability scores for
    // some reason. We need to put them back in if they're not there.
    let essential_re = [/[^>]Str\s?([+-]?\s?\d+).*Dex\s?([+-]?\s?\d+).*Con\s?([+-]?\s?\d+).*Int\s?([+-]?\s?\d+).*Wis\s?([+-]?\s?\d+).*Cha\s?([+-]?\s?\d+).*/g];
    for(var re of essential_re) {
        let match = re.exec(input);
        if( match ) {
            //Note that this will only match if the string isn't preceded by a newline, as . won't match the newline character
            input = input.slice(0, match.index + 1) + '</p>' + input.slice(match.index + 1);
        }
    }

    let lines = input.split(/<\/p>|<br>|\n|<\/div>/ig);

    //The name should be the first line
    //Perhaps it's got the creature part in it
    let creature_match = /CREATURE\s+([+-]?\d+)\s*(.*)$/g.exec(lines[0]);
    let name = lines[0].trim();
    if( creature_match ) {
        name = lines[0].substring(0, creature_match.index).trim();
        lines[0] = lines[0].substring(creature_match.index);
    }
    else {
        lines = lines.slice(1);
    }

    let bracket_index = /\s*\(\s*\d+\s*\)/g.exec(name);
    if( bracket_index ) {
        name = lines[0].substring(0, bracket_index.index);
    }
    //try removing non-printable with magic from stack overflow
    name = name.replace(/[^ -~]+/g, "");

    var output = {name : name,
                  specials : [],
                  strikes : [],
                 };

    var valid_skills = ['acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
                        'lore', 'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth',
                        'survival', 'thievery'];
    var valid_sizes = ['tiny','small','medium','large','huge','gargantuan'];
    var lore_index = 0;


    matchers = [
        { re   : RegExp('^.*CREATURE\\s+([+-]?\\d+)\\s*(.*)','ig'),
          func : (match) => {
              log('Parsing Creature tag');
              output.level = parseInt(match[1]);
              if( match[2] ) {
                  output.traits = match[2].split(/[ ,]+/);
              }
              else {
                  output.traits = [];
              }
              return true;
          },
          name : 'level',
        },
        //Perception is usually followed by a semicolon, but the sinspawn has a comma
        { re   : RegExp('^.*Perception\\s+\\+?(\\d+)[;,]?\\s*(.*)','ig'),
          func : (match) => {
              log('Parsing senses');
              let senses = '';
              if( match[2] ) {
                  senses = match[2].trim();
              }
              output.perception = {value : parseInt(match[1]),
                                   note  : senses
                                  };
              return true;
          },
          name : 'perception',
        },
        { re : RegExp('^Languages\\s+(.*)'),
          func : (match) => {
              log('Parsing languages');
              output.languages = match[1].trim();
              return true;
          },
          name : 'languages',
        },
        { re : RegExp('^Skills\\s+(.*)'),
          func : (match) => {
              log('Parsing skills');

              for( var skill_text of match[1].split(',') ) {

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
                      if( /lore$/ig.exec(skill_name) ) {
                          lore_index += 1;
                          let lore_name = 'lore';
                          if( lore_index == 1 ) {
                              lore_name = 'lore';
                          }
                          else if( lore_index == 2 ) {
                              lore_name = 'lorealt';
                          }
                          else {
                              lore_name = `lore${lore_index}`;
                          }
                          output[lore_name] = {value : skill_value, name : skill_name};
                          if( data[3] ) {
                              output[lore_name].note = data[3].slice(1,-1);
                          }
                      }
                      continue;
                  }
                  output[skill_name] = {value : skill_value};
                  if( data[3] ) {
                      //There's a note! Take off the brackets and save it
                      output[skill_name].note = data[3].slice(1,-1);
                  }
                  //TODO: We could also work out the benchmark here if we felt so inclined
              }
              return true;
          },
          name : 'skills',
        },
        // It would be nice to parse all the attributes now, but sometimes they wrap multiple lines so we'd
        // best just do the first one
        { re : RegExp('^Str\\s?([+-]\\d+).*'),
          func : (match) => {
              // The tiefling adept has a space between its + and its number. Weird. We can allow for that though
              var data = /^Str\s?([+-]?\s?\d+).*Dex\s?([+-]?\s?\d+).*Con\s?([+-]?\s?\d+).*Int\s?([+-]?\s?\d+).*Wis\s?([+-]?\s?\d+).*Cha\s?([+-]?\s?\d+).*/.exec(match[0]);
              if( null == data ) {
                  return;
              }
              output.strength     = {value : data[1].replace(/ /g,'')};
              output.dexterity    = {value : data[2].replace(/ /g,'')};
              output.constitution = {value : data[3].replace(/ /g,'')};
              output.intelligence = {value : data[4].replace(/ /g,'')};
              output.wisdom       = {value : data[5].replace(/ /g,'')};
              output.charisma     = {value : data[6].replace(/ /g,'')};
              return true;
          },
          name : 'attributes',
        },
        { re : RegExp('^Items\\s*(.*)'),
          func : (match) => {
              log('Parsing Items');
              output.items = match[1].trim();
              return true;
          },
          name : 'items',
        },
        //For the saves line we're expecting something of the form AC [number]; Fort +/-[number] (possible
        //note for the save), Ref +/[number] (possible note for the save)
        { re : RegExp('^(AC\\s*\\d.*[;,].*)$', 'i'),
          func : (match) => {
              log('Parsing AC and Saves');
              let data = /AC\s(\d+)\s*(\(.*\).*?)?[;,]\s*Fort\s*[+-]?(\d+)\s*(\(.*?\))?,\s*Ref\s*[+-]?(\d+)\s*(\(.*?\))?,\s*Will\s*[+-]?(\d+)\s*(\(.*?\))?;?\s*\s*(.*)/i.exec(match[0]);
              if( null == data ) {
                  log('Invalid AC line:');
                  log(match[0]);
                  return;
              }
              // data breakdown:
              // [1] == AC
              // [2] == AC notes
              // [3] == Fort
              // [4] == Fort notes
              // [5] == Reflex
              // [6] == Reflex notes
              // [7] == Will
              // [8] == Will notes
              // [9] == general save notes
              var targets = ['ac', 'fortitude', 'reflex', 'will'];
              for( var i = 0; i < targets.length; i++) {
                  let note_value = '';
                  if( data[i*2+2] ) {
                      note_value = data[i*2+2].trim();
                  }
                  output[targets[i]] = {value : data[i*2+1].trim(), note : note_value};
              }
              if( data[9] ) {
                  output.savenote = data[9].trim();
                  if( output.savenote[0] == ',' || output.savenote[0] == ';' ) {
                      output.savenote = output.savenote.slice(1).trim();
                  }
              }
              return true;
          },
          name : 'saves',
        },
        // The HP line can have weaknesses, resistances and immunities, but I suspect some monsters will get
        // printed at some point with those things in a different order, so we'll put it out in more than one regexp
        { re : RegExp('^HP\\s*(\\d+).*','i'),
          func : (match) => {
              log('Parsing HP and defences');
              let data = /HP\s(\d+)\s*(,\s*(.*?);)?(.*)$/i.exec(match[0]);
              if( null == data ) {
                  log('Invalid HP line:')
                  log(match[0]);
                  return;
              }

              output.hp = {value : match[1]};
              if( data[3] ) {
                  output.hp.note = data[3].trim();
              }
              else {
                  output.hp.note = '';
              }
              //Is there hardness?
              let hardness_match = /(hardness[^;]*)/ig.exec(data[4]);
              if( hardness_match && hardness_match[1] ) {
                  output.hp.note += hardness_match[1].trim();
              }

              //That took care of HP, now let's look at immunities, weaknesses and resistances
              var fields = ['immunities','weaknesses','resistances'];
              var targets = ['immunity','weakness','resistance'];

              //We take everything up to the semicolon, which might potentially catch other fields if they omit it.
              for(var i = 0; i < fields.length; i++) {
                  let re = RegExp(`${fields[i]}([^;]*)`,'ig');
                  let field_data = re.exec(data[4]);
                  if( null == field_data || !field_data[1] ) {
                      continue;
                  }
                  // As a safety check, we'll stop at any instance of the other field words
                  let putative_value = field_data[1].trim();
                  for( var j = 0; j < fields.length; j++) {
                      let index = putative_value.toLowerCase().indexOf(fields[j]);
                      if( index != -1 ) {
                          putative_value = putative_value.slice(0, index);
                      }
                  }
                  output[targets[i]] = {value : putative_value.trim()};
              }
              return true;
          },
          name : 'hp',
        },
        // The speeds also needn't be in order
        { re : RegExp('^Speed\\s*(.*)','i'),
          func : (match) => {
              log('Parsing Speeds');
              output.speed = match[1];
              return true;
          },
          name : 'speeds',
        },
        //These are some abilities that don't end in a full stop, because they're universal monster rules or whatever.
        { re  : RegExp('^Golem Antimagic(.*)$',''),
          func : (match) => {
              log('Found Golem Antimagic');
              //we don't parse them here as we want them processed as an ability, but causing this to match
              //allows our "first ability" tracker to be accurate
          },
          name : 'golem antimagic',
        },
        { re  : RegExp('^Frightful Presence(.*)$',''),
          func : (match) => {
              log('Found Frightful presence');
              //we don't parse them here as we want them processed as an ability, but causing this to match
              //allows our "first ability" tracker to be accurate
          },
          name : 'frightful presence',
        },
    ];

    multi_matchers = [
        //Next we're into looking at abilities. We can find simple attacks as they start with "Melee" or "Ranged"
        { re : RegExp('^(Melee|Ranged)\\s*.*',''),
          func : (match) => {
              // The json we're using doesn't have a way to have melee attacks take a number of actions other
              // than one. Perhaps that will always be the case as it's a strike? Hopefully!
              let notes = '';
              let damage = '0';
              let data = /(Melee|Ranged)\s+(\[.*?\])?(.*?)([+-]\d+)\s*(\(.*?\))?.*?Damage\s*(.*)$/ig.exec(match[0]);

              if( null == data || !data[3] || !data[4] || !data[6] ) {
                  //Bloodseekers and maybe others don't have damage listed, just an effect...
                  data = /(Melee|Ranged)\s+(\[.*?\])?(.*?)([+-]\d+)\s*(\(.*?\))?.*(Effect\s*.*)$/ig.exec(match[0]);
                  if( null == data || !data[3] || !data[4] || !data[6] ) {
                      return;
                  }
                  damage = '0';
                  notes = data[6].trim();
              }
              else {
                  damage = data[6].trim();
              }
              let traits = '';
              if( data[5] ) {
                  traits = data[5].slice(1,-1);
              }

              output.strikes.push({name : data[3].trim(),
                                   attack : data[4].trim(),
                                   traits : traits,
                                   damage : damage,
                                   notes : notes,
                                   type : data[1]}
                                 );
              return true;
          },
          name : 'melee',
        },
        // After creature we can get traits which are all caps
        { re   : RegExp('^\\s*([A-Z]+\\s*)+$',''),
          func : (match) => {
              let traits = match[0].trim();
              if( !traits ) {
                  return;
              }
              // Traits when copied from the bestiary appear one on each line, but in PFS scenarios it seems
              // we get them all on one line. Rather than worry about the unusual multi-word trait, we'll
              // assume that all traits are one word which will catch the majority of cases If this is an
              // alignment trait lets set that too
              for( var trait of traits.split(/ +/) ) {
                  if( trait == 'N' ||
                      (trait.length == 2 && 'LNC'.indexOf(trait[0]) != -1 && 'GNE'.indexOf(trait[1]) != -1 )) {
                      output.alignment = trait;
                      continue;
                  }
                  if( valid_sizes.indexOf(trait.toLowerCase()) != -1 ) {
                      output.size = trait.trim();
                      continue;
                  }
                  if( !output.traits ) {
                      output.traits = [trait.trim()];
                  }
                  else {
                      output.traits.push(trait.trim());
                  }
              }
              return true;
          },
          name : 'trait',
        },
        { re  : RegExp('^Rituals(.*)$',''),
          func : (match) => {
              log('Has rituals! Roll20 has no place for this');
          },
          name : 'rituals'
        },
        //Spells
        { re  : RegExp('^(.*)Spells (?:\\d+ [fF]ocus [pP]oint.*)?DC (\\d+)(.*attack ([+-]\\d+))?(.*)$',''),
          func : (match) => {
              log('Parsing spells');

              if( null == match || !match[1] || !match[2] ) {
                  return;
              }
              let type = match[1].trim();
              let DC = match[2];
              let spell_data = match[5];
              let attack = '';
              if( match[4] ) {
                  attack = match[4].trim();
              }
              if( spell_data[0] == ';' || spell_data[0] == ',' ) {
                  spell_data = spell_data.slice(1).trim();
              }

              //let numerals = ['10th', '9th', '8th', '7th', '6th', '5th', '4th', '3rd', '2nd', '1st'];
              let numerals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
              let spells = [];
              for( var j = 0; j < 11; j++ ) {
                  spells.push([]);
              }

              //Do we have focus points?
              let focus_points = '';
              let focus_re = /\((\d+) focus points?\)/ig;
              let focus_match = focus_re.exec(spell_data);
              if( focus_match ) {
                  focus_points = focus_match[1];
                  spell_data = spell_data.slice(0, focus_match.index) + spell_data.slice(focus_re.lastIndex);
              }

              //We start with constant as it should be at the end and we can cut it off after parsing it
              let constant_re = /Constant \((.*)/g;
              let constant = constant_re.exec(spell_data);
              if( constant && constant[1] ) {
                  //We can have multiple constant spells at different levels, which looks like this:
                  //  Constant (5th) tongues; (4th) speak with plants; (2nd) speak with animals
                  // I expect we'll see some without semicolons at some point
                  let constant_levels = constant[1].split(/\(/g);
                  for( var level_data of constant_levels ) {
                      let constant_level_match = /(\d+)(?:st|nd|rd|th)\s*\)(.*)/g.exec(level_data);

                      if( !constant_level_match || !constant_level_match[1] || !constant_level_match[2] ) {
                          continue;
                      }
                      let level = constant_level_match[1];
                      let constant_spells = constant_level_match[2].trim();
                      if( constant_spells.indexOf(';') != -1 ) {
                          constant_spells = constant_spells.slice(0, constant_spells.indexOf(';'));
                      }
                      for( var spell of constant_spells.split(',') ) {
                          spell = spell.trim();
                          //Roll20 doesn't really have a good way to list constant spells that I'm aware of,
                          //just just put it in as a spell with (constant) after it
                          spells[level].push(spell + ' (constant)');
                      }
                  }
                  spell_data = spell_data.slice(0, constant.index);
              }

              // We look for cantrips next because we don't want to accidentally pick them up as spells if the
              // creature doesn't have spells of the same level. I think it's conceivable a creature would
              // have multiple cantrips at different levels, but I don't know of any so let's not worry about
              // them for now

              let cantrip_re = /Cantrips \((\d+)(st|nd|rd|th)\s*\)(.*)/g;
              let cantrips = cantrip_re.exec(spell_data);
              let cantrip_level = '';

              if( cantrips && cantrips[1] ) {
                  cantrip_level = cantrips[1].trim();
              }
              if( cantrips ) {
                  spell_data = spell_data.slice(0, cantrips.index);
              }
              if( cantrips && cantrips[1] && cantrips[3]) {
                  let cantrip_str = cantrips[3];
                  if( cantrip_str.indexOf(';') != -1 ) {
                      cantrip_str = cantrip_str.slice(0, cantrip_str.indexOf(';'));
                  }
                  spells[0].push(cantrip_str.trim());
              }

              for(var i = 0; i < numerals.length; i++) {
                  let spell_level = '';
                  let index = spell_data.indexOf(numerals[i]);
                  if( index != -1 ) {
                      spell_level = spell_data.slice(index + numerals[i].length);
                      if( spell_level.indexOf(';') != -1 ) {
                          spell_level = spell_level.slice(0, spell_level.indexOf(';'));
                      }
                      spell_data = spell_data.slice(0, index);
                  }
                  spells[i+1].push(spell_level.trim());
              }

              for(i = 0; i < spells.length; i++) {
                  spells[i] = spells[i].join(',');
              }


              let target = output;
              if( output.spells ) {
                  target = {name : type};
                  if( !output.morespells ) {
                      output.morespells = [target];
                  }
                  else {
                      output.morespells.push(target);
                  }
              }
              else {
                  output.spelltype = type;
              }
              target.spells = spells.reverse();
              target.cantriplevel = cantrip_level;
              target.spelldc = {value : DC};
              target.spellattack = {value : attack};
              target.focuspoints = focus_points;

              return true;
          },
          name : 'spells',
        },
        { re  : RegExp('^(.*)Rituals DC (\\d+)(.*attack ([+-]\\d+))?(.*)$',''),
          func : (match) => {
              log('Parsing Rituals');
              //we don't parse them here as we want them processed as an ability, but causing this to match
              //allows our "first ability" tracker to be accurate
          },
          name : 'rituals',
        },
        // Match actions that end with the action symbol first, so we give them a different name and don't
        // expect them to end with a full stop.
        { re : RegExp('^.*(\\[one-action\\]|\\[two-actions\\]|\\[three-actions\\]|\\[reaction\\]|\\[free-action\\])$'),
          func : (match) => {log('Found short action ability')},
          name : 'short_action',
        },
        // Via some PDF magic it seems that we get action symbols translated into cool "[one-action]" type
        // text which we can use. It doesn't help us if it's a passive ability, but it helps with a lot of
        // things. Note that melee and ranged should already have been picked up, so this ought to get
        // abilities
        { re : RegExp('^.*(\\[one-action\\]|\\[two-actions\\]|\\[three-actions\\]|\\[reaction\\]|\\[free-action\\]).*'),
          func : (match) => {log('Found action ability')},
          name : 'action',
        },

        // Poisons and diseases don't have the action symbol (as they're usually delivered by some other
        // mechanism), but they should have a list of traits, one of which will be poison or disease.
        { re : RegExp('^.*(\\([^\\)]*(poison|disease).*\\)).*'),
          func : (match) => {log('Found Affliction');},
          name : 'affliction',
        },
    ];
    var matched = {};

    let final_lines = [];
    let current_lines = [];
    var first_ability = true;

    // The first pass will be to fold lines together so we have one line for each thing. The only difficult
    // part to that is special abilities that don't have an action because we can't match on an initial
    // keyword and we lose the bold in the next form. We'll try using if the first n words are capitalized and
    for(var line_num = 0; line_num < lines.length; line_num++) {
        let line = lines[line_num];
        let last_line = lines[line_num - 1];
        // Sometimes when copying from a pdf we get a number on a line on its own, I'm not sure why.
        if( /^\s*\d+\s*$/.exec(line) ) {
            continue;
        }
        // If the stat block went over a page boundary we probably also have our watermark which should include our email address inside carrots
        if( /&lt;.*@.*&gt;/g.exec(line) ) {
            continue;
        }
        line = line.trim();
        if( !line ) {
            continue;
        }

        let match = null;
        // Next we check to see if it matches any of our special matchers
        for( var i = 0; i < matchers.length; i++) {
            if( !matched[matchers[i].name] ) {
                match = matchers[i].re.exec(line);
                if( match ) {
                    matched[matchers[i].name] = true;
                    //when we hit speeds we're in the offensve abilites so we should reset the first count
                    log('Match on: ' + matchers[i].name);
                    if( matchers[i].name == 'speeds' || matchers[i].name == 'saves' ) {
                        first_ability = true;
                    }
                    if( matchers[i].name == 'affliction' || matchers[i].name == 'action' ) {
                        first_ability = false;
                    }
                    break;
                }
            }
        }
        if( null == match ) {
            for( var i = 0; i < multi_matchers.length; i++) {
                match = multi_matchers[i].re.exec(line);
                if( match ) {
                    log('Match on ' + multi_matchers[i].name);
                    if( multi_matchers[i].name == 'affliction' || multi_matchers[i].name == 'action' ) {
                        first_ability = false;
                    }
                    break;
                }
            }
        }

        if( null == match ) {
            // It didn't match anything, but there's still a chance it might be starting a block. I think the
            // only way to tell here is to look at if the first two words are in title case.
            let words = line.split(' ');
            var possible_ability = words.length > 2;
            if( possible_ability ) {
                if( words[0] == 'Critical' && (words[1] =='Success' || words[1] == 'Failure') ) {
                    possible_ability = false;
                }
            }
            if( possible_ability && words[0] == 'Maximum' && words[1] == 'Duration' ) {
                possible_ability = false;
            }
            if( possible_ability && words[0] == 'Saving' && words[1] == 'Throw' ) {
                possible_ability = false;
            }

            if( possible_ability && (words[0] == 'Success' || words[0] == 'Failure' )) {
                // This is less clear because an ability could be called "Success Magnet" or something, but
                // for now let's assume these are part of a block. We could check that adjacent lines had
                // critical in them
                possible_ability = false;
            }
            //We get the number in title case, because there should be a title followed by the first word of a sentence. That last word better not be lower case though otherwise it can't start a sentence
            let num_title = num_in_title(words);
            if( possible_ability && num_title < 1 ) {
                possible_ability = false;
            }
            let title_words = words.slice(0, num_title);
            let putative_title = title_words.join(" ").trim();

            if( possible_ability ) {
                //we can also rule out this ability if it's got any of a short list of bad words in it
                let bad_words = ['GM'];
                //Or if it's exactly equal to something no ability would be called
                let bad_titles = ['damage','stage','hit','constant','effect','requirement','the','any','trigger'];
                let bad_chars = ['+','-','.'];


                for( var bad_word of bad_words ) {
                    if( title_words.indexOf(bad_word) != -1 ){
                        possible_ability = false;
                        break;
                    }
                }
                //similarly if there are any full stops we can reject it
                for( var bad_char of bad_chars ) {
                    if( putative_title.indexOf(bad_char) != -1 ) {
                        possible_ability = false;
                        break;
                    }
                }
                //abilities are unlikely to be called "damage", and we've probably just not connected it to the previous melee
                if(bad_titles.indexOf(putative_title.toLowerCase()) != -1) {
                    possible_ability = false;
                }
            }

            if( possible_ability ) {
                if( words.length == num_title ) {
                    //there needs to be something in the ability
                    possible_ability = false;
                }
                else if( false == is_upper_case(words[num_title][0]) ) {
                    //We expect an ability to start with one of three things:
                    // an action like [one-action]
                    // a list of traits (blah, jim)
                    // a capital letter of a description
                    if( words[num_title][0] != '(' && words[num_title][0] != '[' ){
                        //There's one case, Golem Antimagic text block doesn't start with caps
                        if( lower_case_abilities.indexOf(putative_title) == -1 ) {
                            possible_ability = false;
                        }
                    }
                }
            }

            if( possible_ability && last_line ) {
                //So we've got title case, but what if we have just started a sentance?
                //TODO: We could also rule out the creatures name here?
                let last_index = last_line.lastIndexOf('.');
                let last_sentence = '';

                if( false == first_ability ) {
                    //Abilities *ought* to end with a full stop. If this is the second or subsequent ability
                    //in this section we can rule out starting a new one if we're in the middle of a
                    //sentence. Maybe. The exception is a truncated ability like "attack of opportunity"
                    if( last_index == -1 ) {
                        possible_ability = false;
                    }
                    else if( last_line.slice(last_index + 1).trim() != "" ) {
                        possible_ability = false;
                    }
                }
                else if( last_index != -1 ) {
                    last_sentence = last_line.slice(last_index + 1);
                    words = last_sentence.trim();
                    if(words) {
                        words = words.split(' ');
                        if( words.length > 0 && words.length <= 2 ) {
                            possible_ability = false;
                        }
                    }
                }
            }
            if( false == possible_ability ) {
                current_lines.push(line);
                continue;
            }
            else {
                first_ability = false;
            }
        }

        //If we get here we have a match so this is starting a block. All preceding lines should be merged onto one
        if( current_lines.length > 0 ) {
            final_lines.push( join_ability_lines(current_lines) );
        }
        current_lines = [line];
    }
    if( current_lines.length > 0 ) {
        final_lines.push( join_ability_lines(current_lines) );
    }
    matched = {};
    log('Starting second pass...');

    for(var line_data of final_lines) {
        // We take each line on its own, and decide what to do with it based on its content, and which things
        // we've already seen. If we haven't seen perception yet, then we've probably got a trait. For
        // example. Here are the heuristics we use:
        //
        // - The first line is a name, then creature level
        // - All the lines between the creature level and the perception are traits
        // - Languages and skills can be
        let line = line_data.line;
        line = line.trim();
        let remove = null;
        let handled = false;
        let match = null
        for( var i = 0; i < matchers.length; i++) {
            matchers[i].re.lastIndex = 0;
            match = matchers[i].re.exec(line);
            if( match != null ) {
                log('Second pass match on ' + matchers[i].name);
                handled = matchers[i].func(match);
                remove = i;
                matched[matchers[i].name] = true;
                break;
            }
        }
        if( remove != null ) {
            matchers.splice(remove, 1);
        }
        if( handled ) {
            continue;
        }
        for( var i = 0; i < multi_matchers.length; i++) {
            multi_matchers[i].re.lastIndex = 0;
            match = multi_matchers[i].re.exec(line);
            if( match ) {
                log('Second pass match on ' + multi_matchers[i].name);
                handled = multi_matchers[i].func(match);
                matched[multi_matchers[i].name] = true;
                break;
            }
        }
        if( handled ) {
            continue;
        }

        // If we get here we haven't matched anything else which makes this a generic named ability. If we
        // haven't had the saves yet it's an interactive ability, if we haven't had the speeds yet it's an
        // automatic or reactive ability, and if we have it's an offensive ability

        let ability_type = 'general';
        if( 'speeds' in matched ) {
            ability_type = 'offense';
        }
        else if( 'saves' in matched ) {
            ability_type = 'defense';
        }
        output.specials.push(new_ability(line_data, ability_type));
    }

    output.traits = output.traits.filter(x=>x).join(", ");
    return output;
}

function get_and_parse_character(msg) {
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    var unknown_name = /{{unknown_name=(.*?)}}/g.exec(msg.content);

    if( unknown_name && unknown_name[1] ) {
        log('Using unknown name ' + unknown_name[1]);
        set_attribute(id, 'unknown_name', unknown_name[1]);
    }
    else {
        set_attribute(id, 'unknown_name', '');
    }

    var character = getObj("character", id);

    //GM notes are asynchronous
    character.get(
        'gmnotes',
        (notes) => {
            try {
                let json = clean_json(notes);
                let name = 'unknown';
                let format = 'none';
                if( json ) {
                    parse_json_character(character, JSON.parse(json));
                    format = 'JSON';
                }
                else {
                    let data = load_pdf_data(notes);
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
                let unknown_name = get_attribute(character.id, 'unknown_name');
                if( !unknown_name ) {
                    set_attribute(id, 'unknown_name', name);
                }
                sendChat(module_name, `/w gm Character ${name} parsed successfully using ${format} format`);
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

function show_config_options(msg) {
    let command = /!pf2-config (.*)/.exec(msg.content);
    let message = [`/w ${msg.who} &{template:default} {{name=${module_name} ${module_version} Config}}`];
    let extra_message = '';

    if( false == playerIsGM(msg.playerid) ) {
        sendChat(module_name, `/w ${msg.who} ${module_name} config is restricted to the table GM`);
    }

    if( command && command[1] ) {
        extra_message = '{{Re-parse NPCs to use new values=}}';
        switch(command[1]) {
        case 'toggle_hide':
            state.pf2_helper.hide_rolls = !state.pf2_helper.hide_rolls;
            init_macros();
            break;
        case 'toggle_popups':
            state.pf2_helper.use_map_popups = !state.pf2_helper.use_map_popups;
            break;
        case 'toggle_other_popups':
            state.pf2_helper.use_other_popups = !state.pf2_helper.use_other_popups;
            break;
        case 'toggle_sounds':
            state.pf2_helper.sounds = !state.pf2_helper.sounds;
            extra_message = '';
            break;
        case 'toggle_macros':
            state.pf2_helper.create_macros = !state.pf2_helper.create_macros;
            extra_message = '';
            break;
        default:
            extra_message = '';
        }
    }

    message.push(`{{Default NPC hide rolls=[${state.pf2_helper.hide_rolls}](!pf2-config toggle_hide)}}`)
    message.push(`{{Use MAP popups=[${state.pf2_helper.use_map_popups}](!pf2-config toggle_popups)}}`)
    message.push(`{{Use Sweep/other popups=[${state.pf2_helper.use_other_popups}](!pf2-config toggle_other_popups)}}`)
    message.push(`{{Use sounds=[${state.pf2_helper.sounds}](!pf2-config toggle_sounds)}}`)
    message.push(`{{Create Macros on Start=[${state.pf2_helper.create_macros}](!pf2-config toggle_macros)}}`)
    message.push(extra_message);

    sendChat(module_name, message.join(' '));
}

function handle_api(msg) {
    let command = msg.content.match('!([^\\s]+)');
    if( null == command || command.length < 2 ) {
        return;
    }
    let handlers = {'pf2-attacks'        : show_attack_buttons,
                    'pf2-skills'         : show_skills_buttons,
                    'pf2-ability-checks' : show_ability_check_buttons,
                    'pf2-saves'          : show_save_buttons,
                    'pf2-abilities'      : show_ability_buttons,
                    'pf2-spells'         : show_spell_buttons,
                    'pf2-secret-skill'   : roll_secret_skill,
                    'pf2-secret-skills'  : show_secret_skills_buttons,
                    'pf2-secret'         : roll_secret,
                    'pf2-parse'          : get_and_parse_character,
                    //'init'           : roll_init,
                    'pf2-config'         : show_config_options,
                   };

    command = command[1];
    log('Handling Command: ' + command);

    if( command in handlers ) {
        return handlers[command](msg);
    }
}

function handle_whisper(msg) {
    if(undefined == msg.inlinerolls || msg.target != 'gm' || (!playerIsGM(msg.playerid) && msg.playerid != 'API')) {
        return;
    }
    let roll = null;

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

    sendChat(module_name, roll.format());
}

function handle_general(msg) {
    //We only want to do this for player rolls
    if(undefined == msg.inlinerolls || msg.playerid == 'API') {
        return;
    }
    if(msg.content.match('{{roll01_type=attack')) {
        let roll = new AttackRoll(msg.content, msg.inlinerolls);
        //shouldn't we do something with that?
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
        if( !i ) {
            continue;
        }
        var attrs = attributes[IDs[i]];
        for(var name in attrs) {
            if( !name ) {
                continue;
            }
            attrs[name].remove();
        }
    }
    let objs = findObjs({
	_type: 'attribute',
	_characterid: id
    });
    for( var obj of objs ) {
        let attr_name = obj.get('name');
        if( attr_name == `_reporder_${stub}`) {
            obj.remove();
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
        toggles = '';
        set_attribute(id, 'toggles', toggles);
    }

    toggles = toggles.split(',');
    var new_toggles = [];
    let ignore = ['npcspellcaster','innate','focus','cantrips','normalspells'];

    for( var toggle of Object.keys(toggle_buttons) ) {
        set_attribute(id, toggle_buttons[toggle][0], 0);
    }

    for(var toggle of toggles) {
        if( ignore.includes(toggle) ) {
            continue;
        }
        new_toggles.push(toggle);
    }
    let toggle_string = new_toggles.join(',');

    set_attribute(id, 'toggles', toggle_string);
}

function enable_spellcaster(id, spells, cantrips, focusspells, innate) {
    var toggles = get_attribute(id, 'toggles');
    if( toggles == undefined ) {
        toggles = '';
    }

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

    new_damage += `[[?{Attack|1st,0|2nd,1|3rd+,2}*${damage_dice}]][Forceful]`;
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
    new_attack += `( +?{First Target Attacked?|Yes,0|No,1}[Sweep] )`;
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
    const [IDs, attributes] = getRepeatingSectionAttrs(id,`repeating_${attack_type}-strikes`);
    var bonus_matcher = RegExp("\\+?(\\d+)");
    let sheet_type = getAttrByName(id, 'sheet_type');

    for(var i in IDs) {
        if(!i) {
            continue;
        }
        var attrs = attributes[IDs[i]];
        let name  = attrs['weapon'];
        if(name) {
            name = name.get('current');
        }
        else {
            name = "";
        }
        let bonus = attrs.weapon_strike;
        let traits = attrs.weapon_traits;
        if(traits) {
            traits = '**(' + traits.get('current') + ')**';
        }
        else {
            traits = "";
        }
        let damage = attrs.weapon_strike_damage;
        if(damage) {
            if( state.pf2_helper.use_other_popupes && sheet_type == 'npc' && traits.toLowerCase().includes('forceful') ) {
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
        let damage_type = attrs.weapon_strike_damage_type;
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
            if( sheet_type == 'npc' && state.pf2_helper.use_map_popups && new_bonus.indexOf('?{Attack') == -1 ) {
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
                new_bonus += `([[?{Attack|1st,0|2nd ${pen_2},1|3rd+ ${pen_3},2}*(-${map})]][MAP])`;
                bonus.set('current',new_bonus);
            }
        }
        if( state.pf2_helper.use_other_popups && sheet_type == 'npc' && traits.toLowerCase().includes('sweep') ) {
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
        if( sheet_type == 'npc' ) {
            message.push(`{{${roll_type}0${roll_num}_name=[${name} +${bonus}](!&#13;&#37;{selected|repeating_${attack_type}-strikes_$${i}_ATTACK-DAMAGE-NPC})}} {{${roll_type}0${roll_num}=${damage} ${damage_type} ${traits}}}`);
        }
        else {
            message.push(`{{${roll_type}0${roll_num}_name=[${name} +${bonus}](!&#13;&#37;{selected|repeating_${attack_type}-strikes_$${i}_ATTACK-DAMAGE}) [#2](!&#13;&#37;{selected|repeating_${attack_type}-strikes_$${i}_ATTACK-DAMAGE2}) [#3](!&#13;&#37;{selected|repeating_${attack_type}-strikes_$${i}_ATTACK-DAMAGE3})}} {{${roll_type}0${roll_num}=${damage} ${damage_type} ${traits}}}`);
        }
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

    sendChat(module_name, message.join(" ") );
}

function add_spells(id, roll_num, spell_type, spell_type_name, message) {
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
    const [IDs, attributes] = getRepeatingSectionAttrs(id,`repeating_${spell_type}`);
    var num_spells = IDs.length;
    if(num_spells == 0) {
        return roll_num;
    }
    let spell_levels = {}
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

    sendChat(module_name, message.join(" ") );
}

function show_secret_skills_buttons(msg) {
    var message = [`/w ${msg.who} &{template:rolls} {{header=Secret Skills}} {{desc=`]

    for(var skill of skill_names) {
        message.push(`[${skill}](!pf2-secret-skill {{skill=${skill}&#125;})`);
    }

    let all_lores = new Set();

    //Also add any lores that any of the selected players have
    for( var obj_id of msg.selected ) {
        //Grab the character represented by these
        var obj = getObj(obj_id._type, obj_id._id);
        if( !obj ) {
            continue;
        }
        var character = getObj('character', obj.get('represents'));
        const [IDs, attributes] = getRepeatingSectionAttrs(character.id,'repeating_lore');
        for(var i in IDs) {
            var attrs = attributes[IDs[i]];
            //let name  = getAttrByName(id, `${attr}_$${i}_name`);
            let lore_name = attrs['lore_name'];
            if(lore_name) {
                lore_name = canonical_lore_name(lore_name.get('current'));

                all_lores.add(lore_name);
            }
        }
    }
    for( var lore_name of all_lores ) {
        message.push(`[${lore_name}](!pf2-secret-skill {{skill=${lore_name}&#125;})`);
    }
    message.push('}}')

    sendChat(module_name, message.join(" "));
}

function show_generic_ability_buttons(msg, attr, type) {
    //we want to get all the attacks for the character given by id
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    //var character = getObj("character", id);
    var name = getAttrByName(id, 'character_name');

    //var attacks = getAttrByName(id, "repeating_npc-weapon_$1_macro-text-npc");

    //var num_abilities = getRepeatingSectionCounts(id,attr);
    const [IDs, attributes] = getRepeatingSectionAttrs(id,attr);

    var message = [`/w ${msg.who} &{template:rolls} {{header=${name} ${type}}} {{desc=`]

    for(var i in IDs) {
        let name  = getAttrByName(id, `${attr}_${IDs[i]}_name`);
        message.push(`[${name}](!&#13;&#37;{selected|${attr}_${IDs[i]}_action-npc})`);
    }

    sendChat(module_name, message.join(" ") + '}}');
}

function show_ability_buttons(msg) {
    show_generic_ability_buttons(msg, "repeating_interaction-abilities", "Interaction Abilities");
    show_generic_ability_buttons(msg, "repeating_free-actions-reactions", "Free Actions and Reactions");
    show_generic_ability_buttons(msg, "repeating_actions-activities", "Offensive or Proactive Abilities");
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

    sendChat(module_name, message);
}


function show_skills_buttons(msg) {
    var id = RegExp("{{id=([^}]*)}}").exec(msg.content)[1];
    let message = get_list_buttons(msg, 'Skills', skill_names);

    //Also add any lores we might have
    const [IDs, attributes] = getRepeatingSectionAttrs(id,'repeating_lore');
    for(var i in IDs) {
        var attrs = attributes[IDs[i]];
        //let name  = getAttrByName(id, `${attr}_$${i}_name`);
        let lore_name = attrs['lore_name'];
        if(lore_name) {
            lore_name = canonical_lore_name(lore_name.get('current'));
        }
        message.push(`[${lore_name}](!&#13;&#37;{selected|repeating_lore_${IDs[i]}_LORE})`);
    }
    show_list_buttons(message);
}

function show_save_buttons(msg) {
    let message = get_list_buttons(msg, 'Saves', ['FORT', 'REF', 'WILL']);
    show_list_buttons(message);
}

function show_ability_check_buttons(msg) {
    let message = get_list_buttons(msg, 'Ability Checks', ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
    show_list_buttons(message);
}

function init_macros() {

    // On page creation we're going to make sure the table has all the macros we know will be wanted. This
    // might annoy GMs if they've deleted a macro they don't want and we keep creating it, so we should allow
    // this to be turned off somehow
    let macros = findObjs({type : 'macro'});
    let parse_full = '!pf2-parse {{id=@{selected|character_id}}}';
    if( state.pf2_helper.hide_rolls ) {
        parse_full += ' {{unknown_name=?{What name should the players see? Set to empty string to use actual name|Scary Monster}}}';
    }
    else {
        parse_full += ' {{unknown_name=}}';
    }
    let required_macros = [
        {
            name : 'abilities',
            require : '!pf2-abilities',
            token_action : true,
        },
        {
            name : 'ability-checks',
            require : '!pf2-ability-checks',
            token_action : true,
        },
        {
            name : 'attacks',
            require : '!pf2-attacks',
            token_action : true,
        },
        {
            name : 'parse',
            require : '!pf2-parse',
            full : parse_full,
            token_action : false,
        },
        {
            name : 'saves',
            require : '!pf2-saves',
            token_action : true,
        },
        {
            name : 'secret',
            require : '!pf2-secret',
            full : '!pf2-secret {{bonus=?{Enter your skill bonus:|0}}}',
            token_action : true,
            all_players : true,
        },
        {
            name : 'secret-skills',
            require : '!pf2-secret-skills',
            full : '!pf2-secret-skills',
            token_action : true,
            all_players : true,
        },
        {
            name : 'skills',
            require : '!pf2-skills',
            token_action : true,
        },
        {
            name : 'pf2-config',
            require : '!pf2-config',
            full : '!pf2-config',
            token_action : false,
        },
        {
            name : 'spells',
            require : '!pf2-spells',
            token_action : true,
        },
    ]

    let have_macros = new Set();

    for( var macro of macros ) {
        let action = macro.get('action');
        let match = /^(![^\s]+)/.exec(action);
        if( !match || !match[1] ) {
            continue;
        }

        log('Have existing macro: ' + match[1]);

        if( action.startsWith('!pf2-parse') ) {
            // This is a special one which we might want to rewrite
            if( action != parse_full ) {
                macro.set('action',parse_full);
            }
        }

        have_macros.add(match[1]);
    }

    //To create a macro we need the GM playerid
    let playerids = findObjs({type : 'player'});
    let gmid = null;
    for( var player of playerids ) {
        if( playerIsGM(player.id) ){
            gmid = player.id;
            break;
        }
    }
    if( null == gmid ) {
        log('Error getting GMid');
        return;
    }

    for( var macro of required_macros ) {
        if( have_macros.has(macro.require) ) {
            continue;
        }
        log('Missing macro: ' + macro.require);
        let visibleto = '';
        let full = macro.full;
        if( !full ) {
            full = macro.require + ' {{id=@{selected|character_id}}}';
        }
        if( macro.all_players ) {
            visibleto = 'all';
        }
        createObj('macro', {
            name : macro.name,
            _playerid : gmid,
            action : full,
            istokenaction : macro.token_action,
            visibleto : visibleto});

    }
}

on('change:campaign:turnorder', function() {
    try {
        var turnorder = Campaign().get("turnorder");
        if(turnorder == "")
            return;
        turnorder = JSON.parse(turnorder);

        //Get the person at the top of the order
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

on("ready", function() {
    if( !state.pf2_helper ) {
        state.pf2_helper = {
            hide_rolls : true,
            use_map_popups : true,
            use_other_popups : true,
            sounds : true,
            create_macros : true,
        };
    }

    if( state.pf2_helper.create_macros ) {
        init_macros();
    }
});
