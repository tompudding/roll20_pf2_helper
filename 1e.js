function get_index(msg) {
    var roll_match = RegExp("\\$\\[\\[(\\d+)\\]\\]");

    var index = roll_match.exec(msg);
    if( null == index ) {
        return null;
    }
    return parseInt(index[1], 10);
}

function is_threat(roll) {
    if( roll.mods.customCrit[0].comp != '>=' ) {
        return roll.results[0].v == 20;
    }
    return roll.results[0].v >= roll.mods.customCrit[0].point;
}

function parse_roll(to_hit, die_result, threat) {
    if(die_result == 1) {
        return '[[1d1cs>2]] Fumble'
    }
    else if(die_result == 20) {
        return '[[1d1cf<0cs>1*20]] Natural Twenty!'
    }
    else if(threat) {
        return `[[1d1cf<0cs>1*${to_hit}]]`
    }
    else {
        return `[[${to_hit}]]`
    }
}

class Attack {
    constructor(to_hit, damage, threat, die_result, confirm, confirm_result, crit_damage) {
        this.to_hit = to_hit;
        this.damage = damage;
        this.threat = threat;
        this.confirm = confirm;
        this.crit_damage = damage + crit_damage;
        this.die_result = die_result;

        if( this.to_hit ) {
            this.roll = parse_roll(to_hit, die_result, threat);
            this.confirm = parse_roll(confirm, confirm_result, false);
        }
        else {
            this.roll = null;
            this.confirm = null;
        }

        if(die_result == 1) {
            this.damage = 0
        }
    }

    format(n) {
        var num = "";
        if(n > 0) {
            num = n + 1;
        }

        if( this.to_hit ) {
            return `{{attack${num}=${this.roll}}} {{damage${num}=[[${this.damage}]]}} {{crit_confirm${num}=${this.confirm}}} {{crit_damage${num}=[[${this.crit_damage}]] Total Damage}}`
        }
        else {
            return `{{attack${num}=[[0]]}} {{damage${num}=[[${this.damage}]]}} {{crit_confirm${num}=[[0]]}} {{crit_damage${num}=[[${this.crit_damage}]] Total Damage}} {{no_attack_roll=1}}`
        }
    }
}

class Roll {
    constructor(content, rolls) {
        var attacker_reg = RegExp("{{character_id=([^}]*)}}");
        var attacker_match = attacker_reg.exec(content);
        if( attacker_match.length < 2) {
            log("No character id");
            return;
        }
        var attacker = getObj("character", attacker_match[1]);

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
    }
}

class AttackRoll extends Roll {
    constructor(content, rolls) {
        super(content, rolls);
        var self = this;
        self.attacks = [];

        for(var i = 1; i < 10; i++) {
            var num = "";
            if(i > 1) {
                var num = i;
                self.description += ','
            }
            var array1 = [''];

            var patterns = [`{{attack${num}=([^}]*)}}.*`,
                            `{{damage${num}=([^}]*)}}.*`,
                            `{{crit_confirm${num}=([^}]*)}}.*`,
                            `{{crit_damage${num}=([^}]*)}}.*`,
                            `{{precision_dmg${num}1=([^}]*)}}.*`,
                            `{{precision_dmg${num}2=([^}]*)}}.*`,
                            `{{critical_dmg${num}1=([^}]*)}}.*`,
                            `{{critical_dmg${num}2=([^}]*)}}`]

            for( var pattern of patterns ) {
                let attack_matcher = RegExp(pattern,"g");
                let match = attack_matcher.exec(content);
                if( null == match || match[1] == undefined ) {
                    array1.push('');
                }
                else {
                    array1.push(match[1]);
                }
            }

            if(array1 == null || array1.length < 1) {
                break;
            }

            var attack_index = get_index(array1[1]);
            if( null == attack_index ) {
                log("No attack index");
                break;
            }
            var attack_roll = null;
            var threat = null;
            var crit_confirm = null;

            if( null == RegExp("{{no_attack_roll=1}}","g").exec(content) ) {
                var attack_roll = rolls[attack_index];
                var threat = is_threat(attack_roll.results.rolls[0]);

                var crit_confirm = get_index(array1[3]);
                if( null != crit_confirm ) {
                    var crit_roll = rolls[crit_confirm].results.rolls[0].results[0].v;
                    if(crit_roll == 20) {
                        crit_confirm = "Natural Twenty!";
                    }
                    else if( crit_roll == 1 ) {
                        threat = false;
                    }
                    else {
                        crit_confirm = rolls[crit_confirm].results.total
                    }
                }
            }
            var damage = 0;
            var crit_damage = 0;
            for(var j of [2,5,6]) {
                var index = get_index(array1[j]);
                if( null == index) {
                    continue;
                }
                damage += rolls[index].results.total;
            }

            if( attack_roll ) {
                var to_hit = attack_roll.results.total;
                var die_result = rolls[attack_index].results.rolls[0].results[0].v
            }
            var fumble = false;

            for(var j of [4,7,8]) {
                var index = get_index(array1[j]);
                if( null == index) {
                    continue;
                }
                crit_damage += rolls[index].results.total;
            }

            self.attacks.push(new Attack(to_hit, damage, threat, die_result, crit_confirm, crit_roll, crit_damage))
        }
    }

    format() {
        var self = this;
        var description = `&{template:pf_attack} {{name=${self.name}}} `
        for(var i = 0; i < self.attacks.length; i++) {
            description += self.attacks[i].format(i);
        }
        return description;
    }
}

class Save extends Roll{
    constructor(content, rolls) {
        super(content, rolls);
        var self = this;
        var s = '{{name=\\^{(.*)}}}.*{{\\^{save}=([^}]*)}}'
        var save_matcher = RegExp(s,"g");
        var array1 = save_matcher.exec(content);

        if(array1 == null || array1.length < 3) {
            return;
        }

        var save_index = get_index(array1[2]);
        if( null == save_index ) {
            log("No save index");
            return;
        }
        var save_roll = rolls[save_index];
        self.die_result = save_roll.results.rolls[0].results[0].v;
        self.save_total = save_roll.results.total;
        self.save_name = array1[1];
    }

    format() {
        var self = this;
        var result = parse_roll(self.save_total, self.die_result, false);
        return `&{template:pf_defense} {{character_name=${self.name}}} {{name=${self.save_name}}} {{save=${result}}}`
    }
}


class Skill extends Roll{
    constructor(content, rolls) {
        super(content, rolls);
        var self = this;
        var s = '{{name=\\^{(.*)}}}.*{{Check=([^}]*)}}'
        var matcher = RegExp(s,"g");
        var array1 = matcher.exec(content);

        if(array1 == null || array1.length < 3) {
            return;
        }
        //log('blarray ' + array1)
        var index = get_index(array1[2]);
        if( null == index ) {
            log("No save index");
            return;
        }
        var roll = rolls[index];
        self.die_result = roll.results.rolls[0].results[0].v;
        self.skill_total = roll.results.total;
        self.skill_name = array1[1];
    }

    format() {
        var self = this;
        return `&{template:pf_ability} {{name=${self.skill_name}}} {{Result=[[${self.skill_total}]]}}`
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
        //log('blarray ' + array1)
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


on("chat:message", function(msg) {
  //This allows players to enter !sr <number> to roll a number of d6 dice with a target of 4.
    try {
        if(msg.type != "whisper" || undefined == msg.inlinerolls || msg.target != 'gm' || !playerIsGM(msg.playerid)) {
            return;
        }
        if(msg.content.match('{{attack=')) {
            log(msg.content);
            roll = new AttackRoll(msg.content, msg.inlinerolls);
        }
        else if(msg.content.match('save}=')) {
            roll = new Save(msg.content, msg.inlinerolls);
        }
        else if(msg.content.match('{{Check=')) {
            roll = new Skill(msg.content, msg.inlinerolls);
        }
        else if(msg.content.match('{{check=')) {
            roll = new GenericAttack(msg.content, msg.inlinerolls);
        }
        else {
            return;
        }

        sendChat('GM', roll.format());
    }
    catch(err) {
        log('caught error: ' + err);
    }
});

function set_identified(obj) {
    if( !obj.get("represents") ) {
        return;
    }
    var is_identified = false;

    //The thing we're interested in is the status markers of *all* tokens that represent this object
    var statuses = findObjs({represents:obj.get("represents")});
    for (var status of statuses) {
        if(status.get("statusmarkers").match(/blue/g)) {
            is_identified = true;
        }
    }

    var identified = findObjs({type : 'attribute', characterid: obj.get("represents"), name:'identified'});
    for (var ob of identified) {
        ob.remove();
    }

    createObj("attribute", {name:'identified', current:is_identified, characterid: obj.get("represents")});
}

on('change:graphic:statusmarkers', function(obj, prev) {
    try {
        if( obj.get("statusmarkers") == prev["statusmarkers"] ) {
            return;
        }
        set_identified(obj);
    }
    catch(err){
        log('caught error: ' + err);
    }
})

on('ready', function() {
    try {
        on("add:graphic", function(obj) {
            //Will only be called for new objects that get added, since existing objects have already been loaded before the ready event fires.
            set_identified(obj);
        });
        //You could also set a variable and ignore add events until it is true.
        started = true;
    }
    catch(err){
        log('caught error: ' + err);
    }
});
