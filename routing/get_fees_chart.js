const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getForwards} = require('ln-service');
const {getNode} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const feesForSegment = require('./fees_for_segment');
const forwardsViaPeer = require('./forwards_via_peer');

const daysPerWeek = 7;
const {floor} = Math;
const hoursPerDay = 24;
const limit = 99999;
const minChartDays = 4;
const maxChartDays = 90;

/** Get data for fees chart

  {
    days: <Fees Earned Over Days Count Number>
    is_count: <Return Only Count of Forwards Bool>
    lnd: <Authenticated LND gRPC API Object>
    via: <Via Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    data: [<Earned Fee Tokens Number>]
    description: <Chart Description String>
    title: <Chart Title String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.days) {
          return cbk([400, 'ExpectedNumberOfDaysToGetFeesOverForChart']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetFeesChart']);
        }

        return cbk();
      },

      // Get private channels
      getPrivateChannels: ['validate', ({}, cbk) => {
        return !args.via ? cbk() : getChannels({
          is_private: true,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get node details
      getNode: ['validate', ({}, cbk) => {
        // Exit early when there is no via node specified
        if (!args.via) {
          return cbk();
        }

        return getNode({lnd: args.lnd, public_key: args.via}, cbk);
      }],

      // Segment measure
      measure: ['validate', ({}, cbk) => {
        if (args.days > maxChartDays) {
          return cbk(null, 'week');
        } else if (args.days < minChartDays) {
          return cbk(null, 'hour');
        } else {
          return cbk(null, 'day');
        }
      }],

      // Start date for forwards
      start: ['validate', ({}, cbk) => {
        return cbk(null, moment().subtract(args.days, 'days'));
      }],

      // Get forwards
      getForwards: ['start', ({start}, cbk) => {
        return getForwards({
          limit,
          after: start.toISOString(),
          before: new Date().toISOString(),
          lnd: args.lnd,
        },
        cbk);
      }],

      // Filter the forwards
      forwards: [
        'getForwards',
        'getNode',
        'getPrivateChannels',
        ({getForwards, getNode, getPrivateChannels}, cbk) =>
      {
        if (!args.via) {
          return cbk(null, getForwards.forwards);
        }

        const {forwards} = forwardsViaPeer({
          forwards: getForwards.forwards,
          private_channels: getPrivateChannels.channels,
          public_channels: getNode.channels,
          via: args.via,
        });

        return cbk(null, forwards);
      }],

      // Total earnings
      totalEarned: ['forwards', ({forwards}, cbk) => {
        return cbk(null, forwards.reduce((sum, {fee}) => sum + fee, Number()));
      }],

      // Total number of segments
      segments: ['measure', ({measure}, cbk) => {
        switch (measure) {
        case 'hour':
          return cbk(null, hoursPerDay * args.days);

        case 'week':
          return cbk(null, floor(args.days / daysPerWeek));

        default:
          return cbk(null, args.days);
        }
      }],

      // Forwarding activity aggregated
      sum: [
        'forwards',
        'measure',
        'segments',
        ({forwards, measure, segments}, cbk) =>
      {
        return cbk(null, feesForSegment({forwards, measure, segments}));
      }],

      // Summary description of the fees earned
      description: [
        'forwards',
        'measure',
        'start',
        'sum',
        'totalEarned',
        ({forwards, measure, start, totalEarned, sum}, cbk) =>
      {
        const since = `since ${start.calendar().toLowerCase()}`;

        if (!!args.is_count) {
          const duration = `Forwarded in ${sum.count.length} ${measure}s`;
          const forwarded = `Total: ${forwards.length} forwards`;

          return cbk(null, `${duration} ${since}. ${forwarded}`);
        } else {
          const duration = `Earned in ${sum.fees.length} ${measure}s`;
          const earned = (totalEarned / 1e8).toFixed(8);

          return cbk(null, `${duration} ${since}. Total: ${earned}`);
        }
      }],

      // Summary title of the fees earned
      title: ['getNode', ({getNode}, cbk) => {
        const head = !args.is_count ? 'Routing fees earned' : 'Forwards count';

        if (!args.via) {
          return cbk(null, head);
        }

        const {alias} = getNode;

        return cbk(null, `${head} via ${alias || args.via}`);
      }],

      // Forwarding activity
      data: [
        'description',
        'sum',
        'title',
        ({description, sum, title}, cbk) =>
      {
        const data = !args.is_count ? sum.fees : sum.count;

        return cbk(null, {data, description, title});
      }],
    },
    returnResult({reject, resolve, of: 'data'}, cbk));
  });
};
