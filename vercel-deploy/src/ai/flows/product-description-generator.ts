'use server';

import { z } from 'zod';

const ProductDescriptionInputSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  keywords: z.string(),
});

export type ProductDescriptionInput = z.infer<typeof ProductDescriptionInputSchema>;

const ProductDescriptionOutputSchema = z.object({
  description: z.string().min(1),
});

export type ProductDescriptionOutput = z.infer<typeof ProductDescriptionOutputSchema>;

export async function generateProductDescription(input: ProductDescriptionInput): Promise<ProductDescriptionOutput> {
  const parsedInput = ProductDescriptionInputSchema.safeParse(input);
  if (!parsedInput.success) throw new Error('Provide a product name and category before generating a description.');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Product description generation is not configured.');

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{
          text: `Write an engaging, informative product description based on the following details.

Product name: ${parsedInput.data.productName}
Category: ${parsedInput.data.category}
Keywords: ${parsedInput.data.keywords}`,
        }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { description: { type: 'STRING' } },
          required: ['description'],
        },
      },
    }),
  });

  if (!response.ok) {
    console.error('Gemini product description request failed:', response.status);
    throw new Error('Unable to generate a product description right now.');
  }

  const result = await response.json();
  const generatedText = result.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    .join('')
    .trim();
  if (!generatedText) throw new Error('The AI service returned an empty product description.');

  let generatedOutput: unknown;
  try {
    generatedOutput = JSON.parse(generatedText);
  } catch (error) {
    console.error('Gemini returned invalid product description JSON:', error);
    throw new Error('The AI service returned an invalid product description.');
  }

  const parsedOutput = ProductDescriptionOutputSchema.safeParse(generatedOutput);
  if (!parsedOutput.success) throw new Error('The AI service returned an invalid product description.');
  return parsedOutput.data;
}
