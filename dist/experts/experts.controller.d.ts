import { ExpertsService } from './experts.service';
import { AddBankDetailDto } from './dto/add-bank-detail.dto';
export declare class ExpertsController {
    private readonly expertsService;
    constructor(expertsService: ExpertsService);
    addBankDetail(dto: AddBankDetailDto): Promise<import("./bank-detail.entity").BankDetail>;
    getBankDetails(expertId: string): Promise<import("./bank-detail.entity").BankDetail[]>;
}
