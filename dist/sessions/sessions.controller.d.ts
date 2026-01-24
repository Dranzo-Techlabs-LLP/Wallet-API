import { SessionsService } from './sessions.service';
import { StartSessionDto } from './dto/start-session.dto';
import { AdjustSessionDto } from './dto/adjust-session.dto';
import { EndSessionDto } from './dto/end-session.dto';
export declare class SessionsController {
    private readonly sessionsService;
    constructor(sessionsService: SessionsService);
    start(dto: StartSessionDto): Promise<import("./session.entity").Session>;
    adjust(dto: AdjustSessionDto): Promise<any>;
    end(dto: EndSessionDto): Promise<any>;
}
