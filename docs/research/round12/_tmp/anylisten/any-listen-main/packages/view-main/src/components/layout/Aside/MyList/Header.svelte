<script lang="ts">
  import { t } from '@/plugins/i18n'
  // console.log(params)
</script>

<div class="container">
  <h2>{$t('my_list')}</h2>
</div>

<style lang="less">
  .container {
    flex: none;
    // display: flex;
    // flex-flow: row nowrap;
    // align-items: center;
    padding: 6px 12px;
  }

  h2 {
    font-size: 12px;
    color: var(--color-primary-light-300);
  }
</style>
