"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
const Utils = require("./Utils");
function check(options) {
    if (!options) throw new TypeError("PlayerOptions must not be empty.");
    if (!/^\d+$/.test(options.guild)) throw new TypeError('Player option "guild" must be present and be a non-empty string.');
    if (options.textChannel && !/^\d+$/.test(options.textChannel)) throw new TypeError('Player option "textChannel" must be a non-empty string.');
    if (options.voiceChannel && !/^\d+$/.test(options.voiceChannel)) throw new TypeError('Player option "voiceChannel" must be a non-empty string.');
    if (options.node && typeof options.node !== "string") throw new TypeError('Player option "node" must be a non-empty string.');
    if (typeof options.volume !== "undefined" && typeof options.volume !== "number") throw new TypeError('Player option "volume" must be a number.');
    if (typeof options.selfMute !== "undefined" && typeof options.selfMute !== "boolean") throw new TypeError('Player option "selfMute" must be a boolean.');
    if (typeof options.selfDeafen !== "undefined" && typeof options.selfDeafen !== "boolean") throw new TypeError('Player option "selfDeafen" must be a boolean.');
}

const validAudioOutputs = {
    mono: { // totalLeft: 1, totalRight: 1
        leftToLeft: 0.5, //each channel should in total 0 | 1, 0 === off, 1 === on, 0.5+0.5 === 1
        leftToRight: 0.5,
        rightToLeft: 0.5,
        rightToRight: 0.5,
    },
    stereo: { // totalLeft: 1, totalRight: 1
        leftToLeft: 1,
        leftToRight: 0,
        rightToLeft: 0,
        rightToRight: 1,
    },
    left: { // totalLeft: 1, totalRight: 0
        leftToLeft: 0.5,
        leftToRight: 0,
        rightToLeft: 0.5,
        rightToRight: 0,
    },
    right: { // totalLeft: 0, totalRight: 1
        leftToLeft: 0,
        leftToRight: 0.5,
        rightToLeft: 0,
        rightToRight: 0.5,
    },
}
class Player {
    /**
     * Creates a new player, returns one if it already exists.
     * @param options
     */
    constructor(options) {
        var _a;
        this.options = options;
        /** The Queue for the Player. */
        this.queue = new (Utils.Structure.get("Queue"))();
        /** Whether the queue repeats the track. */
        this.trackRepeat = false;
        /** Whether the queue repeats the queue. */
        this.queueRepeat = false;
        /** The time the player is in the track. */
        this.position = 0;
        /** Whether the player is playing. */
        this.playing = false;
        /** Whether the player is paused. */
        this.paused = false;
        /** The voice channel for the player. */
        this.voiceChannel = null;
        /** The text channel for the player. */
        this.textChannel = null;
        /** The current state of the player. */
        this.state = "DISCONNECTED";
        /** When the player was created [Date] (from lavalink) | null */
        this.createdAt = null;
        /** When the player was created [Timestamp] (from lavalink) | 0 */
        this.createdTimeStamp = 0;
        /** If lavalink says it's connected or not */
        this.connected = undefined;
        /** Last sent payload from lavalink */
        this.payload = { };
        /** Ping to Lavalink from Client */
        this.ping = undefined;
        /** The Voice Connection Ping from Lavalink */
        this.wsPing = undefined,
        /** The equalizer bands array. */
        this.bands = new Array(15).fill(0.0);
        this.data = {};
        this.set("lastposition", this.position);
        if (!this.manager) this.manager = Utils.Structure.get("Player")._manager;
        if (!this.manager) throw new RangeError("Manager has not been initiated.");
        
        // Support multi instances
        if (this.manager.players.has(options.guild)) {
            if(this.manager.players.get(options.guild).manager.options.clientId === options.clientId) {
                return this.manager.players.get(options.guild);
            } else {
                if(options.manager) this.manager = options.manager;
            }
        }
        if(this.manager.options.clientId !== options.clientId) {
            if(options.manager) this.manager = options.manager;
        }
        delete this.options.manager; delete this.options.clientId;
        
        check(options);
        this.guild = options.guild;
        this.voiceState = Object.assign({ op: "voiceUpdate", guildId: options.guild });

        if (options.voiceChannel) this.voiceChannel = options.voiceChannel;
        if (options.textChannel) this.textChannel = options.textChannel;
        
        if(!this.manager.leastLoadNodes?.size) {
            if(this.manager.initiated) this.manager.initiated = false; 
            this.manager.init(this.manager.options?.clientId);
        }
        
        this.region = options?.region;
        
        const node = this.manager.nodes.get(options.node);
        this.node = node || this.manager.leastLoadNodes.filter(x => x.regions?.includes(options.region?.toLowerCase()))?.first() || this.manager.leastLoadNodes.first();
        if (!this.node) throw new RangeError("No available nodes.");
       
        this.manager.players.set(options.guild, this);
        this.manager.emit("playerCreate", this);
        this.setVolume((_a = options.volume) !== null && _a !== void 0 ? _a : 100);
    
        this.instaUpdateFiltersFix = options?.instaUpdateFiltersFix ?? true;
        this.filters = {
            nightcore: false,
            echo: false,
            rotating: false, 
            karaoke: false,
            tremolo: false,
            vibrato: false,
            lowPass: false,
            audioOutput: "stereo",
        } 
        this.filterData = { 
            lowPass: {
                smoothing: 0
            },
            karaoke: {
                level: 0,
                monoLevel: 0,
                filterBand: 0,
                filterWidth: 0
            },
            timescale: {
                speed: 1, // 0 = x
                pitch: 1, // 0 = x
                rate: 1 // 0 = x
            },
            echo: {
                delay: 0,
                decay: 0
            },
            rotating: {
                rotationHz: 0
            },
            tremolo: {
                frequency: 2, // 0 < x
                depth: 0.1 // 0 < x = 1
            },
            vibrato: {
                frequency: 2, // 0 < x = 14
                depth: 0.1      // 0 < x = 1
            },
            channelMix: validAudioOutputs.stereo,
            /*distortion: {
                sinOffset: 0,
                sinScale: 1,
                cosOffset: 0,
                cosScale: 1,
                tanOffset: 0,
                tanScale: 1,
                offset: 0,
                scale: 1
            }*/
        }
    }
    resetFilters() {
        this.filters.echo = false;
        this.filters.nightcore = false;
        this.filters.lowPass = false;
        this.filters.rotating = false;
        this.filters.tremolo = false;
        this.filters.vibrato = false;
        this.filters.karaoke = false;
        this.filters.karaoke = false;
        this.filters.audioOutput = "stereo";
        // disable all filters
        for(const [key, value] of Object.entries({ 
            lowPass: {
                smoothing: 0
            },
            karaoke: {
                level: 0,
                monoLevel: 0,
                filterBand: 0,
                filterWidth: 0
            },
            timescale: {
                speed: 1, // 0 = x
                pitch: 1, // 0 = x
                rate: 1 // 0 = x
            },
            echo: {
                delay: 0,
                decay: 0
            },
            rotating: {
                rotationHz: 0
            },
            tremolo: {
                frequency: 2, // 0 < x
                depth: 0.1 // 0 < x = 1
            },
            vibrato: {
                frequency: 2, // 0 < x = 14
                depth: 0.1      // 0 < x = 1
            },
            channelMix: validAudioOutputs.stereo,
        })) {
            this.filterData[key] = value;
        }
        return this.updatePlayerFilters(); this.filters
    }
    /**
     * 
     * @param {AudioOutputs} type 
     */
    setAudioOutput(type) {
        if(!type || !validAudioOutputs[type])throw "Invalid audio type added, must be 'mono' / 'stereo' / 'left' / 'right'"
        this.filterData.channelMix = validAudioOutputs[type];
        this.filters.audioOutput = type;
        return this.updatePlayerFilters(), this.filters.audioOutput;
    }
    // all effects possible to "toggle"
    toggleRotating(rotationHz = 0.2) {
        const filterDataName = "rotating", filterName = "rotating";
        
        this.filterData[filterDataName].rotationHz = this.filters[filterName] ? 0 : rotationHz;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleVibrato(frequency = 2, depth = 0.5) {
        const filterDataName = "vibrato", filterName = "vibrato";
        
        this.filterData[filterDataName].frequency = this.filters[filterName] ? 0 : frequency;
        this.filterData[filterDataName].depth = this.filters[filterName] ? 0 : depth;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleTremolo(frequency = 2, depth = 0.5) {
        const filterDataName = "tremolo", filterName = "tremolo";
        
        this.filterData[filterDataName].frequency = this.filters[filterName] ? 0 : frequency;
        this.filterData[filterDataName].depth = this.filters[filterName] ? 0 : depth;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleLowPass(smoothing = 20) {
        const filterDataName = "lowPass", filterName = "lowPass";
        
        this.filterData[filterDataName].smoothing = this.filters[filterName] ? 0 : smoothing;
        
        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleEcho(delay = 1, decay = 0.5) {
        const filterDataName = "echo", filterName = "echo";
        
        this.filterData[filterDataName].delay = this.filters[filterName] ? 0 : delay;
        this.filterData[filterDataName].decay = this.filters[filterName] ? 0 : decay;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleNightcore(speed = 1.2999999523162842, pitch = 1.2999999523162842, rate = 1) {
        const filterDataName = "timescale", filterName = "nightcore";

        this.filterData[filterDataName].speed = this.filters[filterName] ? 1 : speed;
        this.filterData[filterDataName].pitch = this.filters[filterName] ? 1 : pitch;
        this.filterData[filterDataName].rate = this.filters[filterName] ? 1 : rate;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    toggleKaraoke(level = 1, monoLevel = 1, filterBand = 220, filterWidth = 100) {
        const filterDataName = "karaoke", filterName = "karaoke";

        this.filterData[filterDataName].level = this.filters[filterName] ? 0 : level;
        this.filterData[filterDataName].monoLevel = this.filters[filterName] ? 0 : monoLevel;
        this.filterData[filterDataName].filterBand = this.filters[filterName] ? 0 : filterBand;
        this.filterData[filterDataName].filterWidth = this.filters[filterName] ? 0 : filterWidth;

        this.filters[filterName] = !!!this.filters[filterName];
        return this.updatePlayerFilters(), this.filters[filterName];
    }
    
    // function to update all filters at ONCE (and eqs)
    updatePlayerFilters() {
        __awaiter(this, void 0, void 0, function* () {
            const sendData = {...this.filterData};
        
            if(!this.filters.tremolo) delete sendData.tremolo;
            if(!this.filters.vibrato) delete sendData.vibrato;
            //if(!this.filters.karaoke) delete sendData.karaoke;
            if(!this.filters.echo) delete sendData.echo;
            if(!this.filters.lowPass) delete sendData.lowPass;
            if(!this.filters.karaoke) delete sendData.karaoke;
            //if(!this.filters.rotating) delete sendData.rotating;
            if(this.filters.audioOutput === "stereo") delete sendData.channelMix;
            const now = Date.now()
            yield this.node.send({
                op: "filters",
                guildId: this.guild,
                equalizer: this.bands.map((gain, band) => ({ band, gain })),
                ...sendData
            });
            this.ping = Date.now() - now;
            if(this.instaUpdateFiltersFix === true) this.filterUpdated = 1;
            return this;
        });
        
    }

    /**
     * Set custom data.
     * @param key
     * @param value
     */
    set(key, value) {
        this.data[key] = value;
    }
    /**
     * Get custom data.
     * @param key
     */
    get(key) {
        return this.data[key];
    }
    /** @hidden */
    static init(manager) {
        this._manager = manager;
    }
    /**
     * Same as Manager#search() but a shortcut on the player itself.
     * @param query
     * @param requester
     */
    search(query, requester, customNode) {
        return this.manager.search(query, requester, customNode||this.node);
    }
    /**
     * Sets the players equalizer band on-top of the existing ones.
     * @param bands
     */
    setEQ(...bands) {
        // Hacky support for providing an array
        if (Array.isArray(bands[0])) bands = bands[0];
        if (!bands.length || !bands.every((band) => JSON.stringify(Object.keys(band).sort()) === '["band","gain"]'))
            throw new TypeError("Bands must be a non-empty object array containing 'band' and 'gain' properties.");
        for (const { band, gain } of bands) this.bands[band] = gain;
        this.updatePlayerFilters();
        return this;
    }
    /** Clears the equalizer bands. */
    clearEQ() {
        this.bands = new Array(15).fill(0.0);
        this.updatePlayerFilters();
        return this;
    }
    /** Connect to the voice channel. */
    connect() {
        if (!this.voiceChannel)
            throw new RangeError("No voice channel has been set.");
        this.state = "CONNECTING";
        this.manager.options.send(this.guild, {
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: this.voiceChannel,
                self_mute: this.options.selfMute || false,
                self_deaf: this.options.selfDeafen || false,
            },
        });
        this.state = "CONNECTED";
        return this;
    }
    /** Disconnect from the voice channel. */
    disconnect() {
        if (this.voiceChannel === null)
            return this;
        this.state = "DISCONNECTING";
        this.pause(true);
        this.manager.options.send(this.guild, {
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: null,
                self_mute: false,
                self_deaf: false,
            },
        });
        this.voiceChannel = null;
        this.state = "DISCONNECTED";
        return this;
    }
    /** Destroys the player. */
    destroy(disconnect = true) {
        this.state = "DESTROYING";
        if (disconnect) {
            this.disconnect();
        }
        this.node.send({
            op: "destroy",
            guildId: this.guild,
        });
        this.manager.emit("playerDestroy", this);
        this.manager.players.delete(this.guild);
    }
    /**
     * Sets the player voice channel.
     * @param channel
     */
    setVoiceChannel(channel) {
        if (typeof channel !== "string")
            throw new TypeError("Channel must be a non-empty string.");
        this.voiceChannel = channel;
        this.connect();
        return this;
    }
    /**
     * Sets the player text channel.
     * @param channel
     */
    setTextChannel(channel) {
        if (typeof channel !== "string")
            throw new TypeError("Channel must be a non-empty string.");
        this.textChannel = channel;
        return this;
    }
    play(optionsOrTrack, playOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof optionsOrTrack !== "undefined" &&
                Utils.TrackUtils.validate(optionsOrTrack)) {
                if (this.queue.current)
                    this.queue.previous = this.queue.current;
                this.queue.current = optionsOrTrack;
            }
            if (!this.queue.current)
                throw new RangeError("No current track.");
            const finalOptions = playOptions
                ? playOptions
                : getOptions(optionsOrTrack)
                    ? optionsOrTrack
                    : {};
            function getOptions(opts) {
                const valids = ["startTime", "endTime", "noReplace", "volume", "pause"];
                const returnObject = {}
                if(!opts) return false;
                for(const [key, value] of Object.entries(Object.assign({}, opts))) {
                    if(valids.includes(key)) returnObject[key] = value;
                }
                return returnObject;
            }
            if (Utils.TrackUtils.isUnresolvedTrack(this.queue.current)) {
                try {
                    const unresolvedTrack = { data: this.queue.current};
                    this.queue.current = yield Utils.TrackUtils.getClosestTrack(this.queue.current, this.node);
                    
                    if(this.queue.current.title == 'Unknown title' && unresolvedTrack.data.title != this.queue.current.title) {
                        this.queue.current.title = unresolvedTrack.data.title;
                        this.queue.current.author = unresolvedTrack.data.author;
                        this.queue.current.thumbnail = unresolvedTrack.data.thumbnail;
                    }
                }
                catch (error) {
                    this.manager.emit("trackError", this, this.queue.current, error);
                    if (this.queue[0])
                        return this.play(this.queue[0]);
                    return;
                }
            }
            const options = Object.assign({ op: "play", guildId: this.guild, track: this.queue.current.track }, finalOptions);
            if (typeof options.track !== "string" && typeof options.track === "object" && options.track.track) {
                options.track = options.track.track;
            }
            this.set("finalOptions", finalOptions);
            if(finalOptions.pause) {
                this.playing = !finalOptions.pause;
                this.paused = finalOptions.pause;
            } else {
                this.playing = true;
                this.paused = false;
            }
            if(finalOptions.volume) this.volume = finalOptions.volume;
            if(finalOptions.startTime) this.position = finalOptions.startTime;
            else this.position = 0;
            this.set("lastposition", this.position);
            const now = Date.now();
            yield this.node.send(options);
            this.ping = Date.now() - now;
        });
    }
    /**
     * Sets the player volume.
     * @param volume
     */
    setVolume(volume) {
        return __awaiter(this, void 0, void 0, function* () {
            volume = Number(volume);
            if (isNaN(volume)) throw new TypeError("Volume must be a number.");
            
            this.volume = Math.max(Math.min(volume, 1000), 0);
            
            let vol = volume;
            if(this.manager.volumeDecrementer) vol *= this.manager.volumeDecrementer;
            const now = Date.now();
            yield this.node.send({
                op: "volume",
                guildId: this.guild,
                volume: Math.max(Math.min(vol, 1000), 0),
            });
            this.ping = Date.now() - now;
            return this;
        });
    }
    /**
     * Sets the track repeat.
     * @param repeat
     */
    setTrackRepeat(repeat) {
        if (typeof repeat !== "boolean")
            throw new TypeError('Repeat can only be "true" or "false".');
        if (repeat) {
            this.trackRepeat = true;
            this.queueRepeat = false;
        }
        else {
            this.trackRepeat = false;
            this.queueRepeat = false;
        }
        return this;
    }
    /**
     * Sets the queue repeat.
     * @param repeat
     */
    setQueueRepeat(repeat) {
        if (typeof repeat !== "boolean")
            throw new TypeError('Repeat can only be "true" or "false".');
        if (repeat) {
            this.trackRepeat = false;
            this.queueRepeat = true;
        }
        else {
            this.trackRepeat = false;
            this.queueRepeat = false;
        }
        return this;
    }
    /** Stops the current track, optionally give an amount to skip to, e.g 5 would play the 5th song. */
    stop(amount) {
        
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof amount === "number" && amount > 1) {
                if (amount > this.queue.length) throw new RangeError("Cannot skip more than the queue length.");
                this.queue.splice(0, amount - 1);
            }
            const now = Date.now()
            yield this.node.send({
                op: "stop",
                guildId: this.guild,
            });
            this.ping = Date.now() - now;
            return this;
        });
    }
    /**
     * Pauses the current track.
     * @param pause
     */
    pause(pause) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof pause !== "boolean") throw new RangeError('Pause can only be "true" or "false".');
            // If already paused or the queue is empty do nothing https://github.com/MenuDocs/erela.js/issues/58
            if (this.paused === pause || !this.queue.totalSize) return this;
            this.playing = !pause;
            this.paused = pause;
            const now = Date.now();
            this.node.send({
                op: "pause",
                guildId: this.guild,
                pause,
            });
            this.ping = Date.now() - now;
            return this;
        });
    }
    /**
     * Seeks to the position in the current track.
     * @param position
     */
    seek(position) {
        return __awaiter(this, void 0, void 0, function* () {
        if (!this.queue.current) return undefined;
            position = Number(position);
            if (isNaN(position)) throw new RangeError("Position must be a number.");
            
            if (position < 0 || position > this.queue.current.duration) position = Math.max(Math.min(position, this.queue.current.duration), 0);
            this.position = position;
            this.set("lastposition", position);
            const now = Date.now();
            this.node.send({
                op: "seek",
                guildId: this.guild,
                position,
            });
            this.ping = Date.now() - now;
            return this;
        });
    }
}
exports.Player = Player;
function deepFreeze(o) {
    Object.freeze(o);
    Object.getOwnPropertyNames(o).forEach(function(prop) {
        if (o.hasOwnProperty(prop) && o[prop] !== null && (typeof o[prop] === "object" || typeof o[prop] === "function") && !Object.isFrozen(o[prop])) deepFreeze(o[prop]);
        return true;
    });
    return o;
}