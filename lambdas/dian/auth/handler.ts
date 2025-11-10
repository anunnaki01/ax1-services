import { Context } from 'aws-lambda';

export const handler = async (event: any, context: Context) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  return {
    success: true,
    message: 'DIAN Auth Lambda',
    data: event
  };
};

