import { Controller, Post, Body } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { StartSessionDto } from './dto/start-session.dto';
import { AdjustSessionDto } from './dto/adjust-session.dto';
import { EndSessionDto } from './dto/end-session.dto';

@Controller('v1/sessions')
export class SessionsController {
    constructor(private readonly sessionsService: SessionsService) { }

    @Post('start')
    start(@Body() dto: StartSessionDto) {
        return this.sessionsService.start(dto);
    }

    @Post('adjust')
    adjust(@Body() dto: AdjustSessionDto) {
        return this.sessionsService.adjust(dto);
    }

    @Post('end')
    end(@Body() dto: EndSessionDto) {
        return this.sessionsService.end(dto);
    }
}
