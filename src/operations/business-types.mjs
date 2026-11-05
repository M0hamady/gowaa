/**
 * Business-type profiles for the isolated operations workspace.
 * This module only describes capabilities; enforcement remains in the domain commands.
 */
export const BUSINESS_TYPES = ['restaurant','supermarket','service'];

const common = ['view_orders','edit_open_order','view_reports'];

export const BUSINESS_PROFILES = {
  restaurant: {
    label:'مطعم / محل أكل',
    roles: {
      owner:{label:'صاحب المحل',permissions:['manage_staff','manage_settings','manage_products','manage_recipes','view_inventory','adjust_inventory','record_waste','manage_tables','move_table_order','merge_checks','approve_discount','view_reports','view_orders','create_pos_order','edit_open_order','send_to_kitchen','view_kitchen','update_kitchen_status','take_payment','refund_payment']},
      manager:{label:'مدير المحل',permissions:['view_orders','edit_open_order','send_to_kitchen','view_kitchen','update_kitchen_status','take_payment','refund_payment','manage_tables','move_table_order','merge_checks','manage_products','manage_recipes','view_inventory','adjust_inventory','record_waste','view_reports','approve_discount']},
      floor_manager:{label:'مدير الصالة',permissions:['view_orders','edit_open_order','send_to_kitchen','manage_tables','move_table_order','merge_checks','approve_discount']},
      floor_worker:{label:'عامل الصالة',permissions:['view_orders','create_pos_order','edit_open_order','send_to_kitchen']},
      cashier:{label:'الكاشير',permissions:['view_orders','create_pos_order','edit_open_order','send_to_kitchen','take_payment','refund_payment']},
      kitchen_worker:{label:'عامل المطبخ',permissions:['view_kitchen','update_kitchen_status']}
    },
    screens: {floor:'tables',cashier:'pos',kitchen:'kds',stock:'kitchen_inventory',recipes:'recipes',reports:'restaurant_reports'}
  },
  supermarket: {
    label:'سوبر ماركت',
    roles: {
      owner:{label:'مالك الفرع',permissions:['manage_staff','manage_settings','manage_products','manage_inventory','receive_stock','adjust_inventory','record_waste','view_reports','view_orders','create_pos_order','edit_open_order','take_payment','refund_payment','manage_prices','manage_suppliers']},
      manager:{label:'مدير الفرع',permissions:['view_orders','edit_open_order','create_pos_order','take_payment','refund_payment','manage_products','manage_inventory','receive_stock','adjust_inventory','record_waste','view_reports','manage_prices']},
      cashier:{label:'الكاشير',permissions:['view_orders','create_pos_order','edit_open_order','take_payment','refund_payment']},
      shelf_worker:{label:'موظف الرفوف',permissions:['view_products','shelf_restock','view_inventory','report_shortage']},
      stockkeeper:{label:'أمين المخزن',permissions:['view_inventory','receive_stock','transfer_stock','adjust_inventory','record_waste','manage_suppliers']},
      receiving_clerk:{label:'موظف الاستلام',permissions:['receive_stock','view_inventory','report_shortage']},
      delivery_worker:{label:'عامل التوصيل',permissions:['view_orders','update_delivery_status']}
    },
    screens: {sales:'pos',stock:'warehouse',receiving:'receiving',shelves:'shelf_tasks',reports:'supermarket_reports'}
  },
  service: {
    label:'نشاط خدمات',
    roles: {
      owner:{label:'صاحب النشاط',permissions:['manage_staff','manage_settings','manage_products','manage_categories','view_reports','view_orders','create_pos_order','take_payment']},
      staff:{label:'فريق النشاط',permissions:['view_orders','edit_open_order','create_pos_order','manage_products']}
    },
    screens: {catalog:'catalog',sales:'orders',reports:'service_reports'}
  }
};

export function normalizeBusinessType(value){
  if(value==='restaurant'||value==='supermarket'||value==='service')return value;
  if(['مطاعم','مطعم','food','restaurant'].includes(value))return 'restaurant';
  if(['بقالة','سوبر ماركت','سوبرماركت','grocery','supermarket'].includes(value))return 'supermarket';
  return 'service';
}

export function businessProfile(value){return BUSINESS_PROFILES[normalizeBusinessType(value)];}
export function roleProfile(type,role){return businessProfile(type).roles[role]||null;}
export function permissionsFor(type,role){return [...(roleProfile(type,role)?.permissions||[])];}
export function canBusinessRole(type,role,permission){return permissionsFor(type,role).includes(permission);}
export function businessScreens(type){return {...businessProfile(type).screens};}

export function visibleBusinessData(type,role){
  const p=roleProfile(type,role);
  if(!p)return {role,permissions:[],screens:{}};
  const permissions=new Set(p.permissions);
  return {
    role,
    permissions:[...permissions],
    screens:Object.fromEntries(Object.entries(businessProfile(type).screens).filter(([key])=>{
      if(key==='sales')return permissions.has('create_pos_order');
      if(key==='cashier')return permissions.has('take_payment');
      if(key==='kitchen'||key==='kds')return permissions.has('view_kitchen');
      if(key==='floor'||key==='shelves')return permissions.has(type==='restaurant'?'manage_tables':'view_products')||type==='supermarket'&&permissions.has('manage_products');
      if(key==='stock')return type==='supermarket'?['manage_inventory','adjust_inventory','transfer_stock','manage_suppliers'].some(x=>permissions.has(x)):permissions.has('view_inventory');
      if(key==='receiving')return permissions.has('receive_stock');
      if(key==='recipes')return permissions.has('manage_recipes');
      if(key==='reports')return permissions.has('view_reports');
      return true;
    }))
  };
}
