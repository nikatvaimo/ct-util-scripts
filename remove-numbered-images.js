import { buildApiClient } from './apiClient.js';
import fs from 'fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dryRun');
const logFilePath = 'output.log'; // Specify your log file path

function hasNumberInParentheses(url) {
  return /\(\d+\)/.test(url);
}

function logToFile(message) {
  fs.appendFileSync(logFilePath, message + '\n', 'utf8');
}

async function processImages() {
  const apiClient = buildApiClient();
  let hasMore = true;
  let offset = 0;
  const limit = 100; // Adjust as needed based on API limits

  while (hasMore) {
    try {
      const {
        body: { results: products, total },
      } = await apiClient.products().get({ queryArgs: { limit, offset } }).execute();

      for (const product of products) {
        const staged = product.masterData.staged;
        const variants = [staged.masterVariant, ...staged.variants];

        const actions = [];

        for (const variant of variants) {
          for (const image of variant.images || []) {
            if (hasNumberInParentheses(image.url)) {
              actions.push({
                action: 'removeImage',
                variantId: variant.id,
                imageUrl: image.url,
                staged: true,
              });
            }
          }
        }

        if (actions.length > 0) {
          const header = `\n${dryRun ? '[DRY RUN]' : '[LIVE]'} Product ${product.key || product.id}:`;
          logToFile(header);
          actions.forEach((a, i) => {
            const actionMessage = `  ${i + 1}. Remove image from variant ${a.variantId}: ${a.imageUrl}`;
            logToFile(actionMessage);
          });

          if (!dryRun) {
            try {
              await apiClient.products().withId({ ID: product.id }).post({
                body: {
                  version: product.version,
                  actions,
                },
              }).execute();
              logToFile(`Successfully updated product ${product.key || product.id}`);
            } catch (updateError) {
              logToFile(`Failed to update product ${product.key || product.id}: ${updateError.message || updateError}`);
            }
          }
        }
      }

      offset += products.length;
      hasMore = offset < total;
    } catch (err) {
      logToFile('Failed to fetch products: ' + (err.message || err));
      break;
    }
  }
}

processImages().catch(err => {
  logToFile('Script failed: ' + (err.message || err));
});
