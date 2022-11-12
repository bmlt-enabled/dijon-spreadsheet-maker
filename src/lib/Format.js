export class Format {
    constructor(json) {
        this.bmlt_id = json.bmltId;
        this.key_string = json.keyString;
        this.name = json.name;
        this.world_id = json.worldId;
        this.naws_code_override = json.nawsCodeOverride;
    }
}
