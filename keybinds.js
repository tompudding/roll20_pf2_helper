(function() {
    const startPlaylist = (playlistName) => {
        $(`#jukeboxfolderroot div.folder-title:contains("${playlistName}")`).closest(".dd-content").find(".playlistcontrols .play").click();
    };

    const startTrack = (trackName) => {
        $(`#jukeboxfolderroot .jukeboxitem .title:contains("${trackName}")`).closest(".dd-content").find(".play").click()
    };

    Mousetrap.unpause();

    //Mousetrap.bind("g", () => startPlaylist("my playlist name"));
    //Mousetrap.bind("j", () => startPlaylist("my other playlist"));
    //Mousetrap.bind("n", () => startPlaylist("asdf"));
    Mousetrap.bind("7", (event) => {if(event.code == "Numpad7"){startTrack("roll_for_initiative");}}, 'keydown');
    Mousetrap.bind("8", (event) => {if(event.code == "Numpad8"){startTrack("fan_fumble");}}, 'keydown');
    Mousetrap.bind("9", (event) => {if(event.code == "Numpad9"){startTrack("critical_thread");}}, 'keydown');
    Mousetrap.bind("4", (event) => {if(event.code == "Numpad4"){startTrack("nerdage_short");}}, 'keydown');
    Mousetrap.bind("5", (event) => {if(event.code == "Numpad5"){startTrack("nerdage_med");}}, 'keydown');
    Mousetrap.bind("6", (event) => {if(event.code == "Numpad6"){startTrack("nerdage_full");}}, 'keydown');
    Mousetrap.bind("1", (event) => {if(event.code == "Numpad1"){startTrack("joe_roll");}}, 'keydown');
    Mousetrap.bind("0", (event) => {if(event.code == "Numpad0"){startTrack("troy_roll");}}, 'keydown');
})()
