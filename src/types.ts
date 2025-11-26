export type CalculationOperation = "add" | "subtract" | "multiply" | "divide";

export interface CalculationRequest {
  a: number;
  b: number;
  operation: CalculationOperation;
}

export interface CalculationResult {
  result: number;
  operation: CalculationOperation;
  operands: {
    a: number;
    b: number;
  };
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface Activity {
  id: number;
  strava_id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  data_json: any;
}
