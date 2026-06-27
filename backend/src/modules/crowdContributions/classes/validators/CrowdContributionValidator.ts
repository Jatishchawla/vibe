import {Type} from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {JSONSchema} from 'class-validator-jsonschema';

const QUESTION_TYPES = ['SELECT_ONE_IN_LOT'] as const;
type QuestionTypeLiteral = (typeof QUESTION_TYPES)[number];
const STATUS_FILTER_VALUES = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ALL'] as const;
type StatusFilterLiteral = (typeof STATUS_FILTER_VALUES)[number];

export class CrowdContributionOptionDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  @JSONSchema({
    description: 'Text content of the MCQ option (1-150 characters).',
    example: 'It repeatedly halves the search space.',
  })
  text!: string;
}

export class SubmitContributionBody {
  @IsString()
  @IsNotEmpty()
  @JSONSchema({
    description:
      'Question type. Only SELECT_ONE_IN_LOT (single-answer MCQ) is supported in Phase 1.',
    enum: [...QUESTION_TYPES],
    default: 'SELECT_ONE_IN_LOT',
  })
  questionType!: QuestionTypeLiteral;

  @IsString()
  @IsNotEmpty()
  @Length(10, 300)
  @JSONSchema({
    description: 'The MCQ prompt (10-300 characters after trimming).',
    example: 'Why must the input be sorted for binary search to work?',
  })
  questionText!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @ValidateNested({each: true})
  @Type(() => CrowdContributionOptionDto)
  @JSONSchema({description: 'Between 2 and 8 answer options.'})
  options!: CrowdContributionOptionDto[];

  @IsInt()
  @Min(0)
  @Max(7)
  @JSONSchema({
    description: 'Zero-based index of the correct option in the options array.',
    example: 0,
  })
  correctOptionIndex!: number;
}

export class ContributionPathParams {
  @IsMongoId()
  courseId!: string;

  @IsMongoId()
  courseVersionId!: string;

  @IsMongoId()
  segmentId!: string;
}

export class CourseVersionPathParams {
  @IsMongoId()
  courseId!: string;

  @IsMongoId()
  courseVersionId!: string;
}

export class ContributionIdPathParams {
  @IsMongoId()
  contributionId!: string;
}

export class MyContributionsQuery {
  @IsOptional()
  @IsString()
  @JSONSchema({
    enum: [...STATUS_FILTER_VALUES],
    description: "Status filter for the current user's contributions. Defaults to ALL.",
  })
  status?: StatusFilterLiteral;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class ReviewQueueQuery {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class RejectContributionBody {
  @IsString()
  @IsNotEmpty()
  @Length(3, 500)
  @JSONSchema({description: 'Reason shown to the student. 3-500 characters.'})
  reason!: string;
}

export class SubmitContributionResponse {
  @IsString()
  @JSONSchema({
    enum: ['accept', 'reject', 'needs_fix', 'unavailable'],
    description: 'Outcome of the on-spot AI screening.',
  })
  result!: 'accept' | 'reject' | 'needs_fix' | 'unavailable';

  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  suggestion?: string;

  @IsOptional()
  @IsString()
  contributionId?: string;
}

export class ContributionListItemResponse {
  @IsString()
  _id!: string;

  @IsString()
  segmentId!: string;

  @IsString()
  questionText!: string;

  @IsArray()
  options!: {text: string}[];

  @IsInt()
  correctOptionIndex!: number;

  @IsString()
  status!: string;

  @IsString()
  createdBy!: string;

  @IsString()
  createdAt!: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class ContributionListResponse {
  @IsArray()
  @ValidateNested({each: true})
  @Type(() => ContributionListItemResponse)
  items!: ContributionListItemResponse[];
}
