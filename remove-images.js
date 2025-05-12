import { buildApiClient } from './apiClient.js';
import csvParser from 'csv-parser';
import fs from 'fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dryRun');
const outputLogFilePath = 'output.log';
const productsCSV = './products.csv';
const ACTIONS_LIMIT = 500;

function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

function readProductsFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const products = [];
    fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          products.push(row);
        })
        .on('end', () => {
          resolve(products);
        })
        .on('error', (error) => {
          reject(error);
        });
  });
}

function logToFile(message) {
  fs.appendFileSync(outputLogFilePath, message + '\n', 'utf8');
}

async function processImages() {
  const apiClient = buildApiClient();

  try {
    const products = await readProductsFromCSV(productsCSV);
    const actionsMap = new Map();

    for (const product of products) {
      // Assuming the CSV has headers: productKey, variantKey, imageUrl
      const { productKey, variantKey, imageUrl } = product;

      if (!actionsMap.has(productKey)) {
        actionsMap.set(productKey, []);
      }

      actionsMap.get(productKey).push({
        action: 'removeImage',
        sku: variantKey,
        imageUrl,
      });
    }

    for (const [productKey, actions] of actionsMap.entries()) { //actionsMap.entries()
      // Add a publish action to the end of each set of actions
      actions.push({ action: 'publish' });

      const actionChunks = chunkArray(actions, ACTIONS_LIMIT);

      for (const [index, actionChunk] of actionChunks.entries()) { //
        const header = `\n${dryRun ? '[DRY RUN]' : '[LIVE]'} Product ${productKey}, Batch ${index + 1}:`;
        logToFile(header);
        actionChunk.forEach((a, i) => {
          const actionMessage = `  ${i + 1}. ${a.action} ${a.sku ? `from variant ${a.sku}` : ''}: ${a.imageUrl || ''}`;
          logToFile(actionMessage);
        });

        if (!dryRun) {
          try {
            // Fetch the current version of the product
            const { body: productData } = await apiClient.products().withKey({ key: productKey }).get().execute();

            await apiClient.products().withKey({ key: productKey }).post({
              body: {
                version: productData.version,
                actions: actionChunk,
              },
            }).execute();

            logToFile(`Successfully updated product ${productKey}, Batch ${index + 1}`);
          } catch (updateError) {
            logToFile(`Failed to update product ${productKey}, Batch ${index + 1}: ${updateError.message || updateError}`);
          }
        }
      }
    }
  } catch (err) {
    logToFile('Failed to process products: ' + (err.message || err));
  }
}

processImages().catch(err => {
  logToFile('Script failed: ' + (err.message || err));
});
