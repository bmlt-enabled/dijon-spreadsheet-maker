export class ServiceBody {
    constructor(json) {
        this.bmlt_id = json.bmltId;  // should this be camel case to match javascript style?
        this.parent_bmlt_id = json.parentBmltId;
        this.name = json.name;
        this.type = json.type;
        this.description = json.description;
        this.url = json.url;
        this.helpline = json.helpline;
        this.world_id = json.worldId;
        this.naws_code_override = json.nawsCodeOverride;
    }
}
